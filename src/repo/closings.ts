import { pool, newId } from "../db/pool.js";
import { calcularCierre, type SpecialRule } from "../engine/cierre.js";
import { revertirMovimiento } from "./ledger.js";

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
  rateSnapshot?: number;
  specialRule?: SpecialRule | null;
  observation?: string | null;
}

/**
 * Aplica un cierre semanal de forma idempotente: la clave (agent_id, club_id, week_start)
 * es única en la base. Si el cierre ya existe, no se recalcula ni se vuelve a aplicar a
 * balances (esto es exactamente la regla de BIT-001: "clave única por semana + agente + club,
 * aplicar el cierre de forma atómica").
 */
export async function aplicarCierreSemanal(input: AplicarCierreInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM weekly_closings WHERE agent_id=$1 AND club_id=$2 AND week_start=$3`,
      [input.agentId, input.clubId, input.weekStart]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { id: existing.rows[0].id, alreadyApplied: true };
    }

    const calc = calcularCierre({
      agentId: input.agentId,
      clubId: input.clubId,
      system: input.system,
      result: input.result,
      rakeTotal: input.rakeTotal,
      rakebackPct: input.rakebackPct,
      rebatePct: input.rebatePct,
      rateSnapshot: input.rateSnapshot ?? 1,
      specialRule: input.specialRule ?? null,
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
      // El agente solo recibe resultado + rakeback; el rebate se desvía íntegro al supervisor.
      montoAgente = calc.result + calc.rakeback;
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
         rate_snapshot, rule_applied, status, observation, rebate_destino, supervisor_agent_id, supervisor_movement_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'APLICADO',$17,$18,$19,$20)`,
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

    await client.query("COMMIT");
    return { id, alreadyApplied: false, calc: { ...calc, finalClosing: montoAgente }, supervisorAgentId, montoSupervisor };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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

  return { found: true, id: closingId };
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
