import { pool, newId } from "../db/pool.js";
import { registrarMovimiento, eliminarMovimiento } from "./ledger.js";
import type { PoolClient } from "pg";

// Rakeback pendiente (22/09/2026, pedido de Leo): al aplicar un cierre semanal, el stock
// físico del agente solo se mueve por el resultado de mesas (Win/Lose) -- ver repo/closings.ts.
// Todo lo demás (rakeback, rebate, Rodeo, ajuste manual) queda ACÁ, pendiente de decidir cómo
// se salda: pagarlo en fichas (mueve stock, movimiento CARGA), pagarlo en USDT/efectivo/Zelle
// (pago financiero real, movimiento PAGO, nunca toca stock) o dejarlo pendiente sin más.

export async function listRakebackPendiente() {
  const r = await pool.query(
    `SELECT rp.*, a.name as agent_name, c.name as club_name, wc.week_start, wc.week_end
     FROM rakeback_pendiente rp
     JOIN agents a ON a.id = rp.agent_id
     JOIN clubs c ON c.id = rp.club_id
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     WHERE rp.active = true AND rp.amount <> rp.consumed
     ORDER BY wc.week_end DESC, a.name`
  );
  return r.rows;
}

export interface CrearRakebackPendienteManualInput {
  agentId: string;
  clubId: string;
  weekStart: string;
  weekEnd: string;
  amount: number;
  notes?: string;
  createdBy?: string;
}

/**
 * Alta MANUAL de un rakeback pendiente viejo que nunca se cargó en el sistema (06/10/2026,
 * pedido de Leo: "quiero que agreguemos un boton rakeback pendiente, para traer rakeback viejos
 * que todavia no pusimos en el sistema, eso tiene que afectar directamente al cierre del
 * agente"). rakeback_pendiente exige un weekly_closing_id real (NOT NULL, UNIQUE por
 * agente+club+semana, ver schema.sql) -- en vez de abrir un caso especial en cada lugar que ya
 * lee rakeback_pendiente/weekly_closings (Saldo anterior en agentesResumen.ts, Liquidaciones,
 * esta misma pantalla), se crea un cierre "fantasma" (is_manual = true, todo en $0 salvo el
 * rakeback que se tipea a mano) que sirve de ancla -- así este pendiente entra sin tocar NADA
 * más del sistema, exactamente como si fuera un cierre real ya aplicado.
 *
 * No toca balances ni ledger_movements (a diferencia de un cierre real vía repo/closings.ts):
 * no hubo ningún movimiento de fichas/plata esa semana vieja, solo queda la deuda de rakeback
 * en sí. system sale del agente (default_system) -- no se le pide a quien carga, un agente no
 * debería tener nunca los dos sistemas a la vez.
 */
export async function crearRakebackPendienteManual(input: CrearRakebackPendienteManualInput) {
  if (!(Math.abs(input.amount) > 0.004)) throw new Error("El monto tiene que ser distinto de 0.");
  if (!input.weekStart || !input.weekEnd) throw new Error("Faltan las fechas de la semana.");
  if (input.weekStart > input.weekEnd) throw new Error("La fecha \"desde\" no puede ser posterior a \"hasta\".");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const agentRes = await client.query(`SELECT id, name, default_system FROM agents WHERE id = $1`, [input.agentId]);
    const agent = agentRes.rows[0];
    if (!agent) throw new Error("No se encontró ese agente.");
    const clubRes = await client.query(`SELECT id, name FROM clubs WHERE id = $1`, [input.clubId]);
    const club = clubRes.rows[0];
    if (!club) throw new Error("No se encontró ese club.");

    const existing = await client.query(
      `SELECT id FROM weekly_closings WHERE agent_id = $1 AND club_id = $2 AND week_start = $3`,
      [input.agentId, input.clubId, input.weekStart]
    );
    if (existing.rows.length > 0) {
      throw new Error(
        `Ya existe un cierre para ${agent.name} en ${club.name} para la semana del ${input.weekStart} -- ` +
          `si el rakeback viejo corresponde a esa semana, hay que corregir ESE cierre en vez de cargar uno manual nuevo.`
      );
    }

    const weeklyClosingId = newId("wc");
    await client.query(
      `INSERT INTO weekly_closings
        (id, agent_id, club_id, week_start, week_end, system, result, rake_total, rakeback_pct,
         rakeback, rebate_pct, rebate, adjusted_result, final_closing, rate_snapshot, status,
         observation, is_manual)
       VALUES ($1,$2,$3,$4,$5,$6,0,0,0,$7,0,0,0,$7,1,'APLICADO',$8,true)`,
      [
        weeklyClosingId,
        input.agentId,
        input.clubId,
        input.weekStart,
        input.weekEnd,
        agent.default_system,
        input.amount,
        `Carga manual de rakeback pendiente histórico (06/10/2026).` + (input.notes ? ` ${input.notes}` : ""),
      ]
    );

    const pendienteId = newId("rp");
    await client.query(
      `INSERT INTO rakeback_pendiente (id, weekly_closing_id, role, agent_id, club_id, amount, consumed, active)
       VALUES ($1,$2,'AGENTE',$3,$4,$5,0,true)`,
      [pendienteId, weeklyClosingId, input.agentId, input.clubId, input.amount]
    );
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
       VALUES ($1,$2,$3,'ALTA',$4,$4,0,$5,$6)`,
      [
        newId("rpm"),
        pendienteId,
        input.agentId,
        input.amount,
        `Carga manual de rakeback pendiente histórico, semana ${input.weekStart} al ${input.weekEnd}.` +
          (input.notes ? ` ${input.notes}` : ""),
        input.createdBy ?? null,
      ]
    );

    await client.query("COMMIT");
    const r = await client.query(
      `SELECT rp.*, a.name as agent_name, c.name as club_name, wc.week_start, wc.week_end
       FROM rakeback_pendiente rp
       JOIN agents a ON a.id = rp.agent_id
       JOIN clubs c ON c.id = rp.club_id
       JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
       WHERE rp.id = $1`,
      [pendienteId]
    );
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface PagarPendienteInput {
  pendienteId: string;
  amount: number;
  medio: "FICHAS" | "USDT" | "EFECTIVO" | "ZELLE";
  custodian?: string;
  notes?: string;
  createdBy?: string;
}

/**
 * Paga (total o parcialmente) un rakeback pendiente. "FICHAS" genera un movimiento CARGA real
 * (SÍ mueve el stock físico del agente); "USDT"/"EFECTIVO"/"ZELLE" generan un PAGO real contra
 * la wallet/caja (NO toca el stock). No corre dentro de la misma transacción que
 * registrarMovimiento (que administra la suya propia) -- mismo criterio ya aceptado en el resto
 * de la app para este tipo de cruces (ver aplicarCrucesCarga en Liquidaciones.tsx).
 */
export async function pagarPendiente(input: PagarPendienteInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");

  const existing = await pool.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true`, [input.pendienteId]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");

  const pendienteDisponible = Number(actual.amount) - Number(actual.consumed);
  if (input.amount > pendienteDisponible + 0.005) {
    throw new Error("El pago no puede superar el monto pendiente disponible.");
  }
  if (input.medio === "EFECTIVO" && !input.custodian) {
    throw new Error("Un pago en efectivo requiere custodio físico (regla BIT-051/052).");
  }

  // PREPAGO (24/09/2026, pedido de Leo, REVERTIDO el mismo día tras verlo reflejado en un
  // cierre real -- Leo: "esas fichas no deberian descontarse de su saldo, porque es pago de
  // rakeback" / "solamente se transforma en fichas cuando le cargamos fichas"): se había hecho
  // que pagar el rakeback pendiente de un PREPAGO en plata real (USDT/EFECTIVO/ZELLE) restara
  // fichas de su saldo (ver corrección de este mismo cambio: revertirDescargaRakebackPrepago.ts).
  // Ahora, para PREPAGO igual que para WIN_LOSE/SUPERVISOR, pagar en USDT/EFECTIVO/ZELLE NUNCA
  // toca el balance/stock de fichas -- ver el bug de 22/09/2026 más abajo. El stock de fichas de
  // un PREPAGO solo se mueve por: cargas reales, el resultado de mesas del cierre, y un adelanto
  // de rakeback pagado en FICHAS (medio === "FICHAS", ver más abajo).

  const reg = await registrarMovimiento({
    idempotencyKey: `pago_rakeback:${input.pendienteId}:${newId("x")}`,
    // FICHAS = CARGA real (mueve el stock físico). USDT/EFECTIVO/ZELLE = "PAGO_RAKEBACK", un
    // tipo propio que SÍ genera su entrada de tesorería pero NUNCA toca el balance/stock del
    // agente (a diferencia de "PAGO", que siempre resta del balance -- ver deltaParaBalance en
    // repo/ledger.ts). Bug encontrado el 22/09/2026 en el test end-to-end: con "PAGO" común,
    // pagar rakeback en USDT restaba del balance de fichas, mezclando de nuevo lo que este
    // cambio entero busca separar. Esto vale para todos los sistemas (WIN_LOSE, SUPERVISOR y
    // también PREPAGO) -- pagar el pendiente en plata real nunca toca el stock de fichas.
    type: input.medio === "FICHAS" ? "CARGA" : "PAGO_RAKEBACK",
    clubId: actual.club_id,
    agentId: actual.agent_id,
    amount: input.amount,
    paymentMethod: input.medio === "FICHAS" ? "SIN_TESORERIA" : input.medio,
    custodian: input.medio === "EFECTIVO" ? input.custodian : undefined,
    occurredAt: new Date(),
    observation:
      input.notes ||
      (input.medio === "FICHAS"
        ? "Pago de rakeback pendiente en fichas."
        : `Pago de rakeback pendiente en ${input.medio}.`),
    createdBy: input.createdBy ?? null,
    // Esto YA queda resuelto acá abajo (rakeback_pendiente.consumed) -- no tiene que abrir
    // además una nota de crédito de "carga pendiente de cruce" para volver a aparecer como
    // pendiente en Liquidaciones (Leo, 22/09/2026).
    sinNotaDeCredito: input.medio === "FICHAS",
  });

  const nuevoConsumed = Number(actual.consumed) + input.amount;
  const r = await pool.query(
    `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [nuevoConsumed, actual.id]
  );
  const pendiente = r.rows[0];
  const rpmId = newId("rpm");
  await pool.query(
    `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      rpmId,
      pendiente.id,
      pendiente.agent_id,
      input.medio === "FICHAS" ? "PAGO_FICHAS" : "PAGO_USDT",
      input.amount,
      pendiente.amount,
      pendiente.consumed,
      reg.id,
      input.notes ?? null,
      input.createdBy ?? null,
    ]
  );
  // movementRowId (28/09/2026, mismo criterio que ajustarAdelanto -- no confundir con reg.id,
  // el movimiento de ledger, que ya viaja adentro de acá): el frontend lo acumula por sesión
  // (Liquidaciones.tsx) y lo manda a guardar/autoguardar junto con la liquidación, para poder
  // revertir el pago si se borra esa liquidación (ver revertirPagoPendiente más abajo).
  return { ...pendiente, movementRowId: rpmId };
}

export interface SaldarPendienteConCruceInput {
  pendienteId: string;
  amount: number;
  notes?: string;
  createdBy?: string;
}

/**
 * Salda (total o parcialmente) un rakeback pendiente CRUZÁNDOLO contra un adelanto ya dado --
 * a diferencia de pagarPendiente, acá NO se genera ningún movimiento de ledger/tesorería nuevo
 * (la plata ya se movió antes, cuando se cargó el adelanto) -- solo marca este pendiente como
 * consumido (29/09/2026, pedido de Leo: "si en liquidación sale el pago en rakeback pendiente
 * tiene que desaparecer" -- antes, cruzar un adelanto en Liquidaciones solo tocaba
 * rakeback_advances, y esta tabla se quedaba mostrando el pendiente entero para siempre, aunque
 * ya estuviera saldado con la plata del adelanto). Se llama desde Liquidaciones.tsx, en el
 * mismo momento en que se cruza el adelanto (ver confirmarModalCruce/confirmarCrucesMasivo).
 * El movimiento queda tipo "CRUCE_ADELANTO" (ver recalcularCadenaPendiente y
 * revertirPagoPendiente más abajo, que ya lo contemplan igual que PAGO_FICHAS/PAGO_USDT).
 */
export async function saldarPendienteConCruce(input: SaldarPendienteConCruceInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");

  // FIX 05/10/2026 (mismo bug de arriba en schema.sql): antes el UPDATE y el INSERT eran dos
  // pool.query() sueltos, cada uno confirmándose solo -- si el INSERT fallaba (como pasaba
  // SIEMPRE acá por el CHECK que le faltaba a 'CRUCE_ADELANTO'), el UPDATE ya había quedado
  // aplicado de todas formas, dejando el pendiente consumido sin ningún movimiento que lo
  // explique. Ahora las dos van en una sola transacción -- si algo falla, no se aplica nada.
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true FOR UPDATE`,
      [input.pendienteId]
    );
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");

    const pendienteDisponible = Number(actual.amount) - Number(actual.consumed);
    if (input.amount > pendienteDisponible + 0.005) {
      throw new Error("El cruce no puede superar el monto pendiente disponible.");
    }

    const nuevoConsumed = Number(actual.consumed) + input.amount;
    const r = await client.query(
      `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [nuevoConsumed, actual.id]
    );
    const pendiente = r.rows[0];
    const rpmId = newId("rpm");
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
       VALUES ($1,$2,$3,'CRUCE_ADELANTO',$4,$5,$6,$7,$8,$9)`,
      [rpmId, pendiente.id, pendiente.agent_id, input.amount, pendiente.amount, pendiente.consumed, null, input.notes ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    return { ...pendiente, movementRowId: rpmId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface CompensarPendienteNegativoInput {
  pendienteId: string;
  amount: number;
  notes?: string;
  createdBy?: string;
}

/**
 * Salda (total o parcialmente) un rakeback pendiente NEGATIVO (el agente quedó debiendo --
 * ver nota de 05/10/2026 en schema.sql) compensándolo contra el resto de LA MISMA liquidación,
 * sin generar ningún movimiento de ledger nuevo -- la plata ya se descontó al pagar de menos
 * otra fila (de otro club) de esa misma liquidación. Ni pagarPendiente ni
 * saldarPendienteConCruce sirven acá: las dos exigen amount > 0 Y amount <= disponible, y un
 * disponible negativo hace que cualquier monto positivo "supere" el disponible -- siempre
 * tiran error. "amount" acá es la magnitud de la deuda que se compensa (positiva, ej. 185.06
 * para un pendiente de -185.06) -- internamente se RESTA de consumed (al revés que
 * pagarPendiente/saldarPendienteConCruce, que suman) para que el disponible (amount - consumed)
 * suba hacia 0 en vez de bajar más.
 */
export async function compensarPendienteNegativo(input: CompensarPendienteNegativoInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true FOR UPDATE`,
      [input.pendienteId]
    );
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");

    const pendienteDisponible = Number(actual.amount) - Number(actual.consumed);
    if (pendienteDisponible > -0.005) {
      throw new Error("Este pendiente no está en negativo -- para pagarlo usá \"Enviar\", no compensación.");
    }
    if (input.amount > Math.abs(pendienteDisponible) + 0.005) {
      throw new Error("La compensación no puede superar la deuda pendiente.");
    }

    const nuevoConsumed = Number(actual.consumed) - input.amount;
    const r = await client.query(
      `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [nuevoConsumed, actual.id]
    );
    const pendiente = r.rows[0];
    const rpmId = newId("rpm");
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
       VALUES ($1,$2,$3,'COMPENSACION',$4,$5,$6,$7,$8,$9)`,
      [rpmId, pendiente.id, pendiente.agent_id, input.amount, pendiente.amount, pendiente.consumed, null, input.notes ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    return { ...pendiente, movementRowId: rpmId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface VincularMovimientoExistenteInput {
  pendienteId: string;
  movementId: string;
  amount: number;
  notes?: string;
  createdBy?: string;
}

/**
 * Liga un movimiento de ledger YA EXISTENTE (una Carga/Pago/Cobro cargado directo en
 * Movimientos, por afuera de "Enviar"/"Cruzar pendientes"/"Compensar") contra un rakeback
 * pendiente -- sin crear ningún movimiento nuevo (la plata ya se movió). Caso real 05/10/2026,
 * pedido de Leo ("El caiman me pagó esto [un Cobro de US$309.44 cargado en Movimientos], por
 * qué aparece en la liquidación del agente?" / "necesito que se crucen estas cosas"): un Cobro/
 * Pago genérico nunca toca rakeback_pendiente.consumed -- solo lo tocan pagarPendiente,
 * saldarPendienteConCruce y compensarPendienteNegativo, y ninguna de las tres sirve para
 * "ya existe el movimiento, solo hay que avisarle a este pendiente".
 *
 * Dirección dinámica, pensada sobre todo para WIN_LOSE (pedido de Leo: "tiene que funcionar...
 * dejar saldo a favor/encontra dependiendo de que pasa la semana"): si el pendiente está
 * positivo (a favor del agente) se comporta como un pago (consumed sube); si está negativo (el
 * agente debe) se comporta como un cobro/compensación (consumed baja) -- mismo criterio que ya
 * usa recalcularCadenaPendiente para el tipo 'VINCULO' más abajo.
 */
export async function vincularMovimientoExistente(input: VincularMovimientoExistenteInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true FOR UPDATE`,
      [input.pendienteId]
    );
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");

    const movRes = await client.query(`SELECT * FROM ledger_movements WHERE id = $1`, [input.movementId]);
    const mov = movRes.rows[0];
    if (!mov) throw new Error("No se encontró ese movimiento.");
    if (mov.agent_id !== actual.agent_id) {
      throw new Error("Ese movimiento es de otro agente -- no corresponde a este pendiente.");
    }
    const yaVinculado = await client.query(
      `SELECT id FROM rakeback_pendiente_movements WHERE movement_id = $1 LIMIT 1`,
      [input.movementId]
    );
    if (yaVinculado.rows.length > 0) {
      throw new Error("Ese movimiento ya está vinculado a un rakeback pendiente.");
    }

    const pendienteDisponible = Number(actual.amount) - Number(actual.consumed);
    if (input.amount > Math.abs(pendienteDisponible) + 0.005) {
      throw new Error("El monto a vincular no puede superar el pendiente disponible.");
    }

    const nuevoConsumed = pendienteDisponible >= 0 ? Number(actual.consumed) + input.amount : Number(actual.consumed) - input.amount;
    const r = await client.query(
      `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [nuevoConsumed, actual.id]
    );
    const pendiente = r.rows[0];
    const rpmId = newId("rpm");
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
       VALUES ($1,$2,$3,'VINCULO',$4,$5,$6,$7,$8,$9)`,
      [rpmId, pendiente.id, pendiente.agent_id, input.amount, pendiente.amount, pendiente.consumed, input.movementId, input.notes ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    return { ...pendiente, movementRowId: rpmId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Recalcula la cadena resulting_amount/resulting_consumed de UN pendiente entero, en orden
// cronológico, después de borrar un movimiento del medio -- en vez de exigir borrar siempre el
// más reciente primero (29/09/2026, pedido de Leo: "eso tiene que estar libre para todo", mismo
// reclamo que ya resolvimos para adelantos, pero ahí con ignorarOrden porque balances es una
// suma corrida; acá la cadena si depende del orden, así que en vez de saltear la validación
// entera se recalculan los saldos de cada movimiento que quede, para que amount/consumed nunca
// queden desincronizados). Solo ALTA fija el amount base (siempre existe, nunca se borra con
// esto); PAGO_FICHAS/PAGO_USDT suman a consumed; BAJA marca active=false sin tocar amount/
// consumed -- mismo efecto que tenían al aplicarse la primera vez (ver pagarPendiente/
// darDeBajaPendiente más arriba).
async function recalcularCadenaPendiente(client: PoolClient, pendienteId: string) {
  const movs = (
    await client.query(
      `SELECT * FROM rakeback_pendiente_movements WHERE pendiente_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [pendienteId]
    )
  ).rows;
  let amount = 0;
  let consumed = 0;
  let active = true;
  for (const m of movs) {
    if (m.type === "ALTA") {
      amount = Number(m.amount);
      consumed = 0;
      active = true;
    } else if (m.type === "PAGO_FICHAS" || m.type === "PAGO_USDT" || m.type === "CRUCE_ADELANTO") {
      consumed += Number(m.amount);
    } else if (m.type === "COMPENSACION") {
      // Sentido opuesto a los de arriba (05/10/2026): COMPENSACION salda un pendiente
      // NEGATIVO, así que el disponible (amount - consumed) tiene que subir hacia 0 -- consumed
      // se RESTA, no se suma (ver compensarPendienteNegativo más abajo).
      consumed -= Number(m.amount);
    } else if (m.type === "VINCULO") {
      // Dirección dinámica (05/10/2026, ver vincularMovimientoExistente más abajo): VINCULO
      // liga un movimiento ya existente, que puede ser tanto un pago (pendiente positivo) como
      // un cobro (pendiente negativo) -- se decide según el disponible EN ESE MOMENTO de la
      // cadena (amount/consumed tal como van quedando en este mismo recorrido), igual que se
      // decidió al crearlo.
      if (amount - consumed >= 0) {
        consumed += Number(m.amount);
      } else {
        consumed -= Number(m.amount);
      }
    } else if (m.type === "BAJA") {
      active = false;
    }
    await client.query(`UPDATE rakeback_pendiente_movements SET resulting_amount = $1, resulting_consumed = $2 WHERE id = $3`, [
      amount,
      consumed,
      m.id,
    ]);
  }
  await client.query(`UPDATE rakeback_pendiente SET amount = $1, consumed = $2, active = $3, updated_at = now() WHERE id = $4`, [
    amount,
    consumed,
    active,
    pendienteId,
  ]);
}

/**
 * Revierte/borra un pago de rakeback pendiente (PAGO_FICHAS/PAGO_USDT) ya aplicado -- a
 * cualquier altura de la cadena de ese pendiente, no solo el más reciente (29/09/2026, pedido
 * de Leo: "eso tiene que estar libre para todo" -- antes exigía borrar en orden estricto, mismo
 * problema que ya habíamos resuelto para adelantos). Primero borra el movimiento de ledger que
 * generó (con ignorarOrden=true, mismo fundamento ya documentado en eliminarMovimiento: balances
 * es una suma corrida, no depende del orden global), después borra esta fila y recalcula la
 * cadena entera de este pendiente (ver recalcularCadenaPendiente arriba) para que amount/
 * consumed queden bien sin importar en qué posición estaba. No toca ALTA -- esa fija el origen
 * del pendiente, no se borra con esto (para eso está eliminarPendiente, que exige no tener nada
 * pagado todavía).
 */
export async function revertirPagoPendiente(pendienteMovementId: string) {
  const movRes = await pool.query(`SELECT * FROM rakeback_pendiente_movements WHERE id = $1`, [pendienteMovementId]);
  const mov = movRes.rows[0];
  if (!mov) throw new Error("No se encontró ese pago.");
  if (
    mov.type !== "PAGO_FICHAS" &&
    mov.type !== "PAGO_USDT" &&
    mov.type !== "CRUCE_ADELANTO" &&
    mov.type !== "COMPENSACION" &&
    mov.type !== "VINCULO"
  ) {
    throw new Error("Esto no es un pago (la ALTA no se revierte así).");
  }
  // VINCULO es la excepción (05/10/2026): a diferencia de PAGO_FICHAS/PAGO_USDT (donde el
  // movimiento de ledger lo CREÓ pagarPendiente, y por eso es suyo para borrar), el movimiento
  // de un VINCULO ya existía ANTES y de forma independiente (se cargó directo en Movimientos) --
  // deshacer el vínculo no tiene que borrar ese Cobro/Pago real, solo desligarlo de este
  // pendiente.
  if (mov.movement_id && mov.type !== "VINCULO") {
    await eliminarMovimiento(mov.movement_id, { ignorarOrden: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const movRes2 = await client.query(`SELECT * FROM rakeback_pendiente_movements WHERE id = $1 FOR UPDATE`, [pendienteMovementId]);
    const mov2 = movRes2.rows[0];
    if (!mov2) throw new Error("No se encontró ese pago.");

    await client.query(`DELETE FROM rakeback_pendiente_movements WHERE id = $1`, [pendienteMovementId]);
    await recalcularCadenaPendiente(client, mov2.pendiente_id);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Da de baja un rakeback pendiente sin pagarlo (ej. se decide perdonarlo, o se cargó mal) --
 * queda en 0 disponible, sin generar ningún movimiento de plata. No borra nada (ver
 * eliminarPendiente para eso).
 */
export async function darDeBajaPendiente(pendienteId: string, notes?: string, createdBy?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true FOR UPDATE`, [pendienteId]);
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");
    const r = await client.query(`UPDATE rakeback_pendiente SET active = false, updated_at = now() WHERE id = $1 RETURNING *`, [pendienteId]);
    const pendiente = r.rows[0];
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
       VALUES ($1,$2,$3,'BAJA',0,$4,$5,$6,$7)`,
      [newId("rpm"), pendiente.id, pendiente.agent_id, pendiente.amount, pendiente.consumed, notes ?? null, createdBy ?? null]
    );
    await client.query("COMMIT");
    return pendiente;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borrado real de un rakeback pendiente (ej. cargado de prueba) -- bloqueado si ya se pagó algo,
 * mismo criterio que eliminarCarga en repo/cargaCruces.ts.
 */
export async function eliminarPendiente(pendienteId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 FOR UPDATE`, [pendienteId]);
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente.");
    if (Number(actual.consumed) > 0) {
      throw new Error("Este rakeback pendiente ya tiene pagos aplicados -- no se puede borrar.");
    }
    await client.query(`DELETE FROM rakeback_pendiente_movements WHERE pendiente_id = $1`, [pendienteId]);
    await client.query(`DELETE FROM rakeback_pendiente WHERE id = $1`, [pendienteId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reconstrucción histórica del rakeback pendiente (30/09/2026, pedido de Leo: "necesito poder
// recrear ese valor para saber si esta bien o esta mal" -- comparando contra el "Saldo anterior"
// de Resumen por agente, que SÍ suma el rakeback pendiente además del saldo de fichas). Para uno
// o varios agentes, calcula cuánto rakeback pendiente seguía sin cobrarse EN CADA una de las
// fechas pedidas -- usando el estado real que tenía cada pendiente en ese momento (no el estado
// actual), a partir de rakeback_pendiente_movements (que guarda resulting_amount/
// resulting_consumed ya calculados después de cada ALTA/PAGO_FICHAS/PAGO_USDT/BAJA, ver
// recalcularCadenaPendiente más arriba). Un pendiente dado de BAJA cuenta como 0 desde ese
// momento (mismo criterio que ya usa listRakebackPendiente/getResumenAgentePDF, que solo miran
// los activos) -- OJO: esto es una reconstrucción histórica de verdad (el estado que tenía cada
// pendiente EN esa fecha puntual), mientras que "Saldo anterior" de Resumen por agente usa el
// estado ACTUAL de los pendientes viejos (rp.amount/rp.consumed de HOY, no de la fecha de esa
// semana) -- si algún pendiente se pagó más después, los dos números legítimamente no van a
// coincidir, y esto no es un error de ninguno de los dos lados.
export async function getRakebackPendienteEnFechas(
  agentIds: string[],
  fechas: string[],
  clubId: string | null
): Promise<Record<string, number>> {
  if (agentIds.length === 0 || fechas.length === 0) return {};
  const r = await pool.query(
    `SELECT to_char(d.fecha, 'YYYY-MM-DD') as fecha,
            COALESCE(SUM(CASE WHEN latest.type = 'BAJA' THEN 0 ELSE latest.resulting_amount - latest.resulting_consumed END), 0) as outstanding
     FROM (SELECT DISTINCT unnest($2::date[]) as fecha) d
     LEFT JOIN LATERAL (
       SELECT DISTINCT ON (rpm.pendiente_id) rpm.pendiente_id, rpm.type, rpm.resulting_amount, rpm.resulting_consumed
       FROM rakeback_pendiente_movements rpm
       JOIN rakeback_pendiente rp ON rp.id = rpm.pendiente_id
       WHERE rpm.agent_id = ANY($1) AND rpm.occurred_at::date <= d.fecha
         AND ($3::text IS NULL OR rp.club_id = $3)
       ORDER BY rpm.pendiente_id, rpm.occurred_at DESC, rpm.id DESC
     ) latest ON true
     GROUP BY d.fecha`,
    [agentIds, fechas, clubId]
  );
  const map: Record<string, number> = {};
  for (const row of r.rows) map[row.fecha] = Number(row.outstanding);
  // Fechas sin ningún pendiente todavía (ninguna fila coincidió) -- 0, no "sin datos".
  for (const f of fechas) if (!(f in map)) map[f] = 0;
  return map;
}
