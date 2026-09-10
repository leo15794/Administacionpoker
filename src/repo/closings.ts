import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";
import { calcularCierre, calcularCierreBancado, type SpecialRule } from "../engine/cierre.js";
import { revertirMovimiento } from "./ledger.js";
import { procesarRodeoAgenteTx, restaurarMemoriaRodeoTx, type RodeoJugadorEntrada } from "./rodeo.js";

// Traduce una fila de rule_versions al SpecialRule que entiende el motor de cierre genérico.
// Motor de reglas configurable: nunca "if (agente === 'Manzur')" en el código de negocio — la
// regla vive en la base, versionada, y acá solo se resuelve el rule_key a la forma que espera
// calcularCierre. Un rule_key que no aplica a un cierre semanal (ej. CAJERO_CREDITO, que es
// para cargas a crédito, no para el cierre) simplemente no genera un SpecialRule acá.
function resolverSpecialRule(rule: { rule_key: string; params: any } | null): SpecialRule | null {
  if (!rule) return null;
  if (rule.rule_key === "MANZUR_75_RAKE") {
    const pctRake = Number(rule.params?.pctRake);
    return { key: "MANZUR_75_RAKE", pctRake: Number.isFinite(pctRake) ? pctRake : 0.75 };
  }
  return null;
}

export interface AplicarCierreInput {
  agentId: string;
  clubId: string;
  weekStart: string; // 'YYYY-MM-DD'
  weekEnd: string;
  system: "PREPAGO" | "WIN_LOSE";
  result: number;
  rakeTotal: number;
  rakebackPct: number;
  rebatePct: number;
  /** "Rodeo" (solo SupremaPoker): NUNCA se recibe ya calculado del cliente — se manda el
   * detalle crudo por jugador (Player ID + rodeo base de esa semana, con signo: positivo si
   * el jugador perdió, negativo si ganó) y acá se recalcula la memoria y el reparto dentro de
   * la misma transacción (ver repo/rodeo.ts). Vacío/undefined para cualquier cierre que no
   * venga de una importación Suprema — no afecta en nada al resto de los agentes/clubes. */
  rodeoJugadores?: RodeoJugadorEntrada[];
  rateSnapshot?: number;
  /** @deprecated Ya no se usa: la regla especial se resuelve sola desde rule_versions (motor
   * de reglas configurable). Se mantiene el campo solo para no romper llamadas viejas. */
  specialRule?: SpecialRule | null;
  observation?: string | null;
  /** Si es true, corre EXACTAMENTE la misma lógica (incluye validar supervisor, resolver
   * reglas especiales, calcular memoria de bancado) pero al final hace ROLLBACK en vez de
   * COMMIT: no se escribe nada. Así la vista previa del formulario de Cierres nunca puede
   * mostrar un número distinto al que realmente se aplicaría. */
  preview?: boolean;
}

/**
 * Aplica un cierre semanal de forma idempotente: la clave (agent_id, club_id, week_start)
 * es única en la base. Si el cierre ya existe, no se recalcula ni se vuelve a aplicar a
 * balances (esto es exactamente la regla de BIT-001: "clave única por semana + agente + club,
 * aplicar el cierre de forma atómica").
 *
 * Si el agente es de tipo BANCADO, este mismo endpoint (mismo formulario, mismos campos) usa
 * el motor de cierre de bancados en vez de la fórmula genérica — ver aplicarCierreBancadoTx.
 * "result" pasa a ser el resultado propio del bancado en la mesa, "rakebackPct" el % de rakeback
 * (100% suyo) y "rebatePct" el % de la mesa (si fue positiva) que le corresponde a él.
 */
export async function aplicarCierreSemanal(input: AplicarCierreInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Una fila REVERTIDO no cuenta como "ya aplicado": el revert existe justamente para poder
    // volver a cerrar bien esa semana (ver índice único parcial en schema.sql, que ahora ignora
    // status REVERTIDO por la misma razón).
    const existing = await client.query(
      `SELECT id FROM weekly_closings WHERE agent_id=$1 AND club_id=$2 AND week_start=$3 AND status <> 'REVERTIDO'`,
      [input.agentId, input.clubId, input.weekStart]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { id: existing.rows[0].id, alreadyApplied: true, preview: input.preview ?? false };
    }

    const agentRes = await client.query(`SELECT account_type FROM agents WHERE id = $1`, [input.agentId]);
    if (agentRes.rows[0]?.account_type === "BANCADO") {
      const result = await aplicarCierreBancadoTx(client, input);
      await client.query(input.preview ? "ROLLBACK" : "COMMIT");
      return { ...result, preview: input.preview ?? false };
    }

    // Motor de reglas configurable: la regla especial (si el agente tiene una vigente para
    // este club, o global) se resuelve SOLA desde rule_versions — nunca depende de que quien
    // carga el cierre la tipee a mano. Esto es lo que hoy faltaba: la regla de Manzur (75% del
    // rake) existe en el motor y está testeada, pero nada la disparaba en producción porque el
    // formulario de Cierres no tenía forma de pasarla.
    const ruleRow = await client.query(
      `SELECT rule_key, params FROM rule_versions
       WHERE agent_id = $1 AND (club_id = $2 OR club_id IS NULL)
         AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
       ORDER BY (club_id IS NULL) ASC, valid_from DESC
       LIMIT 1`,
      [input.agentId, input.clubId, input.weekEnd]
    );
    // Tiny GG ya NO manda ninguna regla especial (ver engine/cierre.ts, auditoría 10/09/2026):
    // usa la misma fórmula genérica que GG/TeamBack GG/Fénix, resuelta acá abajo como cualquier
    // otro club sin regla configurable vigente.
    const specialRule: SpecialRule | null = resolverSpecialRule(ruleRow.rows[0] ?? null);

    // "Rodeo" (solo SupremaPoker): procesa la memoria del AGENTE (agregada, no por jugador —
    // ver engine/rodeo.ts) DENTRO de esta misma transacción — si más abajo se hace ROLLBACK
    // (vista previa), esta actualización de memoria se revierte sola, igual que bancados.
    const rodeoResultado = input.rodeoJugadores?.length
      ? await procesarRodeoAgenteTx(client, input.agentId, input.clubId, input.rodeoJugadores)
      : { baseRodeoTotal: 0, jugadores: [], memoriaAnterior: 0, payable: 0, memoriaNueva: 0, clubShare: 0, agentShare: 0 };

    const calc = calcularCierre({
      agentId: input.agentId,
      clubId: input.clubId,
      system: input.system,
      result: input.result,
      rakeTotal: input.rakeTotal,
      rakebackPct: input.rakebackPct,
      rebatePct: input.rebatePct,
      rodeo: rodeoResultado.agentShare,
      rateSnapshot: input.rateSnapshot ?? 1,
      specialRule,
    });

    // Módulo de supervisores (punto 5 del documento): si el club de este deal tiene
    // rebate_destino = RAKEBACK_SUPERVISOR, el rebate de ESTE cierre no engorda el saldo
    // operativo del agente — se acredita centralizado al supervisor configurado en
    // agents.supervisor. Nunca se resuelve en silencio: si el club pide ese destino y el
    // agente no tiene un supervisor válido cargado, se bloquea el cierre en vez de perder
    // o mal-asignar la plata.
    const clubRes = await client.query(`SELECT rebate_destino FROM clubs WHERE id = $1`, [input.clubId]);
    const rebateDestino: string = clubRes.rows[0]?.rebate_destino ?? "SALDO_OPERATIVO";

    let supervisorAgentId: string | null = null;
    let montoAgente = calc.finalClosing;
    let montoSupervisor = 0;

    if (rebateDestino === "RAKEBACK_SUPERVISOR" && calc.rebate !== 0) {
      const agentRes = await client.query(`SELECT supervisor FROM agents WHERE id = $1`, [input.agentId]);
      const supervisorName: string | null = agentRes.rows[0]?.supervisor ?? null;
      if (!supervisorName) {
        throw new Error(
          `El club de este cierre tiene el rebate configurado con destino "Rakeback supervisor", pero el agente no tiene un supervisor cargado. Asigná un supervisor al agente (pestaña Editar) antes de aplicar este cierre.`
        );
      }
      const supRes = await client.query(`SELECT id FROM agents WHERE name = $1 AND active = true`, [supervisorName]);
      if (!supRes.rows[0]) {
        throw new Error(
          `El supervisor "${supervisorName}" cargado en el agente no existe (o está inactivo) como agente en el catálogo — corregilo antes de aplicar este cierre.`
        );
      }
      supervisorAgentId = supRes.rows[0].id;
      // El agente solo recibe resultado + rakeback + rodeo; el rebate se desvía íntegro al
      // supervisor. El Rodeo (SupremaPoker) nunca se desvía — es un bono propio del agente,
      // no una porción del rake como el rebate.
      montoAgente = calc.result + calc.rakeback + calc.rodeo;
      montoSupervisor = calc.rebate;
    }

    const id = newId("wc");
    let supervisorMovementId: string | null = null;

    if (supervisorAgentId) {
      supervisorMovementId = newId("mov");
      await client.query(
        `INSERT INTO ledger_movements
          (id, idempotency_key, type, club_id, agent_id, amount, status, occurred_at, observation)
         VALUES ($1,$2,'AJUSTE',$3,$4,$5,'APLICADO',$6,$7)`,
        [
          supervisorMovementId,
          `cierre_supervisor:${input.agentId}:${input.clubId}:${input.weekStart}`,
          input.clubId,
          supervisorAgentId,
          montoSupervisor,
          input.weekEnd,
          `Rakeback centralizado de supervisor por cierre semanal ${input.weekStart} al ${input.weekEnd} (agente id ${input.agentId}).`,
        ]
      );
      await client.query(
        `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (agent_id, club_id)
         DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
        [newId("bal"), supervisorAgentId, input.clubId, montoSupervisor]
      );
    }

    await client.query(
      `INSERT INTO weekly_closings
        (id, agent_id, club_id, week_start, week_end, system, result, rake_total,
         rakeback_pct, rakeback, rebate_pct, rebate, adjusted_result, final_closing,
         rate_snapshot, rule_applied, status, observation, rebate_destino, supervisor_agent_id, supervisor_movement_id, rodeo, rodeo_club_share, rodeo_detalle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'APLICADO',$17,$18,$19,$20,$21,$22,$23)`,
      [
        id,
        input.agentId,
        input.clubId,
        input.weekStart,
        input.weekEnd,
        input.system,
        calc.result,
        calc.rakeTotal,
        calc.rakebackPct,
        calc.rakeback,
        calc.rebatePct,
        calc.rebate,
        calc.adjustedResult,
        montoAgente,
        input.rateSnapshot ?? 1,
        calc.ruleApplied,
        input.observation ?? null,
        rebateDestino,
        supervisorAgentId,
        supervisorMovementId,
        calc.rodeo,
        rodeoResultado.clubShare,
        input.rodeoJugadores?.length
          ? JSON.stringify({
              memoriaAnterior: rodeoResultado.memoriaAnterior,
              memoriaNueva: rodeoResultado.memoriaNueva,
              jugadores: rodeoResultado.jugadores, // desglose informativo: cuánto aportó cada jugador
            })
          : null,
      ]
    );

    // El cierre final se refleja como movimiento en el ledger (no se edita balances a mano).
    await client.query(
      `INSERT INTO ledger_movements
        (id, idempotency_key, type, club_id, agent_id, amount, status, occurred_at, observation)
       VALUES ($1,$2,'CIERRE_SEMANAL',$3,$4,$5,'APLICADO',$6,$7)`,
      [
        newId("mov"),
        `cierre:${input.agentId}:${input.clubId}:${input.weekStart}`,
        input.clubId,
        input.agentId,
        montoAgente,
        input.weekEnd,
        `Cierre semanal ${input.weekStart} al ${input.weekEnd}` +
          (calc.ruleApplied ? ` (regla especial: ${calc.ruleApplied})` : "") +
          (calc.rodeo ? ` — incluye Rodeo: ${calc.rodeo}.` : "") +
          (supervisorAgentId ? ` — rebate (${calc.rebate}) desviado a rakeback de supervisor.` : ""),
      ]
    );

    await client.query(
      `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
       VALUES ($1,$2,$3,$4, now())
       ON CONFLICT (agent_id, club_id)
       DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
      [newId("bal"), input.agentId, input.clubId, montoAgente]
    );

    await client.query(input.preview ? "ROLLBACK" : "COMMIT");
    return {
      id,
      alreadyApplied: false,
      calc: { ...calc, finalClosing: montoAgente },
      supervisorAgentId,
      montoSupervisor,
      preview: input.preview ?? false,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Motor de cierre de cuentas tipo BANCADO (caso real Matías Fontal — ver calcularCierreBancado
 * para la fórmula completa). Corre DENTRO de la misma transacción que aplicarCierreSemanal
 * (recibe su client, no abre ni cierra conexión). La "memoria" (deuda eterna) se lee y escribe
 * con FOR UPDATE para que dos cierres del mismo agente+club nunca puedan pisarse la deuda.
 */
async function aplicarCierreBancadoTx(client: PoolClient, input: AplicarCierreInput) {
  const debtRes = await client.query(
    `SELECT * FROM bancado_debts WHERE agent_id = $1 AND club_id = $2 FOR UPDATE`,
    [input.agentId, input.clubId]
  );
  const deudaAnterior = debtRes.rows[0] ? Number(debtRes.rows[0].debt) : 0;

  const calc = calcularCierreBancado({
    mesaResult: input.result,
    rakeTotal: input.rakeTotal,
    rakebackPct: input.rakebackPct,
    agentSharePct: input.rebatePct,
    deudaAnterior,
  });

  if (debtRes.rows[0]) {
    await client.query(`UPDATE bancado_debts SET debt = $1, updated_at = now() WHERE agent_id = $2 AND club_id = $3`, [
      calc.deudaNueva,
      input.agentId,
      input.clubId,
    ]);
  } else {
    await client.query(
      `INSERT INTO bancado_debts (id, agent_id, club_id, debt) VALUES ($1,$2,$3,$4)`,
      [newId("bdt"), input.agentId, input.clubId, calc.deudaNueva]
    );
  }

  const id = newId("wc");
  await client.query(
    `INSERT INTO weekly_closings
      (id, agent_id, club_id, week_start, week_end, system, result, rake_total,
       rakeback_pct, rakeback, rebate_pct, rebate, adjusted_result, final_closing,
       rate_snapshot, rule_applied, status, observation, bancado_digiplayers_share, bancado_debt_before, bancado_debt_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'BANCADO','APLICADO',$16,$17,$18,$19)`,
    [
      id,
      input.agentId,
      input.clubId,
      input.weekStart,
      input.weekEnd,
      input.system,
      calc.mesaResult,
      calc.rakeTotal,
      input.rakebackPct,
      calc.rakeback,
      input.rebatePct,
      calc.bancadoShareMesa,
      calc.bancadoOwnAmount,
      calc.finalClosing,
      input.rateSnapshot ?? 1,
      input.observation ?? null,
      calc.digiplayersShare,
      calc.deudaAnterior,
      calc.deudaNueva,
    ]
  );

  await client.query(
    `INSERT INTO ledger_movements
      (id, idempotency_key, type, club_id, agent_id, amount, status, occurred_at, observation)
     VALUES ($1,$2,'CIERRE_SEMANAL',$3,$4,$5,'APLICADO',$6,$7)`,
    [
      newId("mov"),
      `cierre:${input.agentId}:${input.clubId}:${input.weekStart}`,
      input.clubId,
      input.agentId,
      calc.finalClosing,
      input.weekEnd,
      `Cierre semanal (bancado) ${input.weekStart} al ${input.weekEnd}. Mesa: ${calc.mesaResult}, rakeback: ${calc.rakeback}, ganancia DigiPlayers (fichas en el club, informativa): ${calc.digiplayersShare}, memoria: ${calc.deudaAnterior} -> ${calc.deudaNueva}.`,
    ]
  );

  await client.query(
    `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (agent_id, club_id)
     DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
    [newId("bal"), input.agentId, input.clubId, calc.finalClosing]
  );

  return { id, alreadyApplied: false, calc, bancado: true };
}

/**
 * Revierte un cierre semanal cargado por error: LEDGER INMUTABLE, nunca se borra. Revierte
 * el efecto en el saldo a través de revertirMovimiento (que también marca REVERTIDO la fila
 * de weekly_closings asociada) y, si por algún motivo no se encuentra el movimiento del
 * ledger (dato viejo/inconsistente), marca igual REVERTIDO la fila de weekly_closings para
 * que no quede activa sin respaldo. Exclusivo de administrador.
 */
export async function revertirCierreSemanal(closingId: string, motivo?: string, revertidoPor?: string | null) {
  const wcRes = await pool.query(`SELECT * FROM weekly_closings WHERE id = $1`, [closingId]);
  const wc = wcRes.rows[0];
  if (!wc) return { found: false };
  if (wc.status === "REVERTIDO") {
    throw new Error("Este cierre ya fue revertido antes — no se puede revertir dos veces.");
  }

  const movRes = await pool.query(
    `SELECT id FROM ledger_movements
     WHERE agent_id = $1 AND club_id = $2 AND type = 'CIERRE_SEMANAL' AND occurred_at::date = $3::date AND status <> 'REVERTIDO'`,
    [wc.agent_id, wc.club_id, wc.week_end]
  );
  const movId = movRes.rows[0]?.id;

  if (movId) {
    await revertirMovimiento(movId, motivo, revertidoPor);
  } else {
    await pool.query(`UPDATE weekly_closings SET status = 'REVERTIDO' WHERE id = $1`, [closingId]);
  }

  // Si el rebate de este cierre se había desviado a un supervisor (módulo de supervisores),
  // ese ajuste tampoco se borra: se revierte con el mismo mecanismo, para que el rakeback
  // centralizado del supervisor quede correcto una vez revertido el cierre que lo generó.
  if (wc.supervisor_movement_id) {
    try {
      await revertirMovimiento(wc.supervisor_movement_id, motivo ? `Reversión de cierre revertido: ${motivo}` : "Reversión de cierre revertido.", revertidoPor);
    } catch {
      // Si ya estaba revertido (o no se encuentra) no bloqueamos la reversión del cierre principal.
    }
  }

  // Módulo de bancados: la "memoria" (deuda) es un valor corrido semana a semana, no un
  // movimiento del ledger — revertir el movimiento de arriba no la toca. Se restaura acá al
  // valor que tenía ANTES de este cierre (bancado_debt_before). Esto asume que se revierten
  // cierres de bancado en orden cronológico inverso (el más reciente primero); revertir uno
  // viejo fuera de orden dejaría la memoria inconsistente con cierres posteriores no revertidos.
  if (wc.rule_applied === "BANCADO" && wc.bancado_debt_before !== null) {
    await pool.query(
      `UPDATE bancado_debts SET debt = $1, updated_at = now() WHERE agent_id = $2 AND club_id = $3`,
      [wc.bancado_debt_before, wc.agent_id, wc.club_id]
    );
  }

  // "Rodeo" (solo SupremaPoker): mismo principio que la memoria de bancados, pero de la
  // memoria del AGENTE (agregada, no por jugador — ver engine/rodeo.ts) — restaura la memoria
  // al valor que tenía antes de este cierre (snapshot guardado en rodeo_detalle.memoriaAnterior).
  // Misma advertencia: asume reversión en orden cronológico inverso; revertir un cierre viejo
  // fuera de orden con cierres posteriores del mismo agente ya aplicados dejaría su memoria
  // inconsistente.
  if (wc.rodeo_detalle?.memoriaAnterior !== undefined) {
    await restaurarMemoriaRodeoTx(wc.agent_id, wc.club_id, Number(wc.rodeo_detalle.memoriaAnterior));
  }

  return { found: true, id: closingId };
}

/**
 * BORRADO REAL de un cierre semanal — a diferencia de revertirCierreSemanal, esto NO deja
 * rastro en el historial. Existe únicamente para limpiar datos de PRUEBA cargados por error
 * mientras se prueba el sistema (pedido explícito del usuario) — nunca usar sobre un cierre de
 * plata real ya operada: para eso siempre "Revertir", que es lo que mantiene el ledger
 * auditable (ver nota de ledger inmutable en todo este archivo).
 *
 * Funciona sobre un cierre en cualquier estado:
 *  - Si todavía está ACTIVO: primero deshace su efecto en los saldos (agente y, si el rebate
 *    se había desviado, supervisor) y restaura memoria de bancado/rodeo al valor de antes —
 *    el mismo cálculo que revertirCierreSemanal, pero aplicado directo a balances en vez de
 *    generar un movimiento AJUSTE de reversa (no tendría sentido crear un rastro para borrarlo
 *    en el siguiente paso).
 *  - Si ya estaba REVERTIDO: los saldos ya están corregidos por esa reversión anterior — acá
 *    solo se borra el rastro (el movimiento original + su reversa) para limpiar el historial.
 *
 * Localiza el/los movimiento(s) de ledger de ESTE cierre por (agente, club, tipo, fecha) — si
 * ese agente+club+semana se cerró/revirtió más de una vez, puede haber más de un movimiento
 * REVERTIDO que matchea; en ese caso se aborta en vez de adivinar cuál borrar (ver mismo
 * comentario en revertirCierreSemanal sobre por qué la clave no alcanza para desambiguar).
 */
export async function eliminarCierreSemanalDefinitivo(closingId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const wcRes = await client.query(`SELECT * FROM weekly_closings WHERE id = $1 FOR UPDATE`, [closingId]);
    const wc = wcRes.rows[0];
    if (!wc) {
      await client.query("ROLLBACK");
      return { found: false };
    }

    const yaRevertido = wc.status === "REVERTIDO";

    const movRes = await client.query(
      `SELECT id FROM ledger_movements
       WHERE agent_id = $1 AND club_id = $2 AND type = 'CIERRE_SEMANAL' AND occurred_at::date = $3::date
         AND status ${yaRevertido ? "= 'REVERTIDO'" : "<> 'REVERTIDO'"}`,
      [wc.agent_id, wc.club_id, wc.week_end]
    );
    if (movRes.rows.length > 1) {
      await client.query("ROLLBACK");
      throw new Error(
        "Hay más de un movimiento de ledger que podría corresponder a este cierre (mismo agente+club+semana cerrado/revertido varias veces) — no se puede borrar automáticamente sin riesgo de borrar el que no es. Avisá para hacerlo a mano."
      );
    }
    const movId: string | null = movRes.rows[0]?.id ?? null;

    // Si todavía está activo, deshace su efecto en el saldo ANTES de borrar nada — mismo delta
    // que sumó aplicarCierreSemanal, con el signo invertido, aplicado directo (sin generar
    // ningún movimiento de reversa: se está por borrar todo, no tiene sentido dejar un rastro).
    if (!yaRevertido) {
      await client.query(
        `INSERT INTO balances (id, agent_id, club_id, amount, updated_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (agent_id, club_id) DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
        [newId("bal"), wc.agent_id, wc.club_id, -Number(wc.final_closing)]
      );
      if (wc.supervisor_agent_id) {
        await client.query(
          `INSERT INTO balances (id, agent_id, club_id, amount, updated_at) VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (agent_id, club_id) DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
          [newId("bal"), wc.supervisor_agent_id, wc.club_id, -Number(wc.rebate)]
        );
      }
      if (wc.rule_applied === "BANCADO" && wc.bancado_debt_before !== null) {
        await client.query(
          `UPDATE bancado_debts SET debt = $1, updated_at = now() WHERE agent_id = $2 AND club_id = $3`,
          [wc.bancado_debt_before, wc.agent_id, wc.club_id]
        );
      }
      if (wc.rodeo_detalle?.memoriaAnterior !== undefined) {
        await restaurarMemoriaRodeoTx(wc.agent_id, wc.club_id, Number(wc.rodeo_detalle.memoriaAnterior));
      }
    }

    // IDs de movimientos a borrar del todo: el de este cierre, el del supervisor (si tenía), y
    // — solo si ya estaba revertido — sus respectivas reversas (que si no, no existen: en la
    // rama de arriba nunca se generó ninguna).
    const idsBase = [movId, wc.supervisor_movement_id].filter((x): x is string => !!x);
    const idsABorrar = new Set(idsBase);
    if (yaRevertido && idsBase.length > 0) {
      const reversasRes = await client.query(`SELECT id FROM ledger_movements WHERE refs && $1::text[]`, [idsBase]);
      for (const r of reversasRes.rows) idsABorrar.add(r.id);
    }

    if (idsABorrar.size > 0) {
      const ids = [...idsABorrar];
      await client.query(`DELETE FROM treasury_entries WHERE movement_id = ANY($1::text[])`, [ids]);
      await client.query(`DELETE FROM ledger_movements WHERE id = ANY($1::text[])`, [ids]);
    }

    await client.query(`DELETE FROM weekly_closings WHERE id = $1`, [closingId]);

    await client.query("COMMIT");
    return { found: true, id: closingId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listClosings(weekStart?: string) {
  const r = weekStart
    ? await pool.query(
        `SELECT wc.*, a.name as agent_name, c.name as club_name FROM weekly_closings wc
         JOIN agents a ON a.id = wc.agent_id JOIN clubs c ON c.id = wc.club_id
         WHERE week_start = $1 ORDER BY a.name`,
        [weekStart]
      )
    : await pool.query(
        `SELECT wc.*, a.name as agent_name, c.name as club_name FROM weekly_closings wc
         JOIN agents a ON a.id = wc.agent_id JOIN clubs c ON c.id = wc.club_id
         ORDER BY wc.week_start DESC, a.name`
      );
  return r.rows;
}
