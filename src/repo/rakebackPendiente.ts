import { pool, newId } from "../db/pool.js";
import { registrarMovimiento, eliminarMovimiento } from "./ledger.js";

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
     WHERE rp.active = true AND rp.amount > rp.consumed
     ORDER BY wc.week_end DESC, a.name`
  );
  return r.rows;
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

/**
 * Revierte un pago de rakeback pendiente (PAGO_FICHAS/PAGO_USDT) ya aplicado -- mismo mecanismo
 * que eliminarMovimientoAdelanto (repo/advances.ts): solo se puede deshacer el movimiento MÁS
 * RECIENTE de ESTE pendiente puntual (la cadena resulting_amount/resulting_consumed exige orden
 * estricto), y primero borra el movimiento de ledger que generó (con ignorarOrden=true, mismo
 * fundamento ya documentado en eliminarMovimiento: balances es una suma corrida, no depende del
 * orden global). No toca ALTA/BAJA -- esas no son pagos, no se revierten con esto (28/09/2026,
 * pedido de Leo: "cuando eliminamos una liquidación todo tiene que volver para atrás" -- hasta
 * acá borrar una liquidación no revertía los pagos reales, solo los cruces de adelantos/cargas).
 */
export async function revertirPagoPendiente(pendienteMovementId: string) {
  const movRes = await pool.query(`SELECT * FROM rakeback_pendiente_movements WHERE id = $1`, [pendienteMovementId]);
  const mov = movRes.rows[0];
  if (!mov) throw new Error("No se encontró ese pago.");
  if (mov.type !== "PAGO_FICHAS" && mov.type !== "PAGO_USDT") {
    throw new Error("Esto no es un pago (ALTA/BAJA no se revierten así).");
  }
  if (mov.movement_id) {
    await eliminarMovimiento(mov.movement_id, { ignorarOrden: true });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const movRes2 = await client.query(`SELECT * FROM rakeback_pendiente_movements WHERE id = $1 FOR UPDATE`, [pendienteMovementId]);
    const mov2 = movRes2.rows[0];
    if (!mov2) throw new Error("No se encontró ese pago.");

    const ultimo = await client.query(
      `SELECT id FROM rakeback_pendiente_movements WHERE pendiente_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov2.pendiente_id]
    );
    if (ultimo.rows[0]?.id !== pendienteMovementId) {
      throw new Error("Solo se puede revertir el pago MÁS RECIENTE de este pendiente -- revertilos en orden, del más nuevo hacia atrás.");
    }

    const anterior = await client.query(
      `SELECT resulting_amount, resulting_consumed FROM rakeback_pendiente_movements
       WHERE pendiente_id = $1 AND id <> $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov2.pendiente_id, pendienteMovementId]
    );
    const amount = anterior.rows[0] ? Number(anterior.rows[0].resulting_amount) : Number(mov2.resulting_amount);
    const consumed = anterior.rows[0] ? Number(anterior.rows[0].resulting_consumed) : 0;

    await client.query(
      `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2`,
      [consumed, mov2.pendiente_id]
    );
    await client.query(`DELETE FROM rakeback_pendiente_movements WHERE id = $1`, [pendienteMovementId]);
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
