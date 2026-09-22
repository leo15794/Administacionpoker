// Adelantos de rakeback: plata (fichas o USDT) adelantada a un agente A CUENTA de un rakeback
// que todavía no se generó — separado del saldo operativo, igual que Garantías (BIT-034),
// mientras no se compense contra un cierre real no es plata que el agente "ganó". Por AGENTE, no
// por agente+club (corregido 11/09/2026): el rake que lo compensa puede salir de cualquier club.
// CADA ADELANTO ES INDEPENDIENTE (corregido 12/09/2026, segunda vuelta): un mismo agente puede
// tener varios adelantos activos al mismo tiempo — se los puede dar varias veces en la misma
// semana, y en clubes distintos — así que ya no existe "el" adelanto de un agente (una sola fila
// reutilizada con Aumento/Reducción), sino una lista de adelantos puntuales; cada ajuste
// (Aumento/Reducción/Consumo/Baja/Corrección) apunta a un adelanto por id, nunca al agente en
// general. club_origen_id es solo una referencia informativa de dónde se originó ESE adelanto en
// particular — nunca limita contra qué club se puede compensar después.
//
// medio (22/09/2026, pedido de Leo): "los adelanto de rakeback en fichas tiene que afectar el
// monto en fichas de los agentes" — un adelanto en FICHAS mueve el stock físico YA en el Alta
// (movimiento CARGA real, mismo mecanismo que pagarPendiente en rakeback_pendiente.ts), y se
// descuenta después en la liquidación real ("es un adelanto de sueldo y después se descuenta" —
// por eso CONSUMO, que es justamente ese descuento en Liquidaciones, NO genera un segundo
// movimiento de stock: el stock ya se movió acá). Un adelanto en USDT sale de la wallet YA en el
// Alta ("los adelantos de usdt tienen que afectar a la wallet porque salen de ahí") con un
// movimiento propio (ADELANTO_RAKEBACK) que genera su entrada de tesorería pero, a propósito, no
// toca el balance/stock del agente (ver deltaParaBalance en repo/ledger.ts) — el "cuánto se le
// debe" lo sigue trackeando esta tabla (amount/consumed), no el balance operativo. Un adelanto
// SIN medio (filas viejas, de antes de este cambio) no mueve nada, se comporta como siempre.
// AUMENTO sobre un adelanto con medio también genera su propio movimiento adicional (mismo club
// de origen que el Alta). REDUCCION/BAJA nunca mueven stock/wallet de vuelta: no representan una
// devolución física de fichas/plata, solo corrigen cuánto se le sigue debiendo al agente (si
// hace falta recuperar fichas/plata de verdad, eso es un movimiento aparte, no esta pantalla).
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";
import { registrarMovimiento as registrarMovimientoLedger, eliminarMovimiento as eliminarMovimientoLedger } from "./ledger.js";

export type AdvanceMovementType = "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA" | "CORRECCION";
export type AjusteMovementType = "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA";
export type AdvanceMedio = "FICHAS" | "USDT";

export interface AltaAdelantoInput {
  agentId: string;
  amount: number;
  medio?: AdvanceMedio | null; // omitir/null = adelanto viejo estilo, no mueve stock ni wallet
  clubOrigenId?: string | null; // obligatorio si medio viene informado (de dónde sale la plata/fichas)
  notes?: string;
  createdBy?: string;
}

export interface AjusteAdelantoInput {
  advanceId: string; // siempre apunta a UN adelanto puntual, nunca "el del agente"
  type: AjusteMovementType;
  amount: number; // siempre positivo — el signo lo decide el "type"
  notes?: string;
  createdBy?: string;
}

export interface CorreccionAdelantoInput {
  advanceId: string;
  amount?: number; // nuevo monto TOTAL (no delta) — omitir para no tocarlo
  consumed?: number; // nuevo consumido TOTAL (no delta) — omitir para no tocarlo
  clubOrigenId?: string | null; // omitir (undefined) para no tocarlo; null para borrarlo
  notes?: string; // motivo de la corrección (opcional), queda en el historial si se cargó
  createdBy?: string;
}

// Todos los adelantos activos, de todos los agentes — puede haber varias filas para el mismo
// agente (uno por cada adelanto independiente que tenga vigente).
export async function listAdvancesConAgente() {
  const r = await pool.query(
    `SELECT ra.*, a.name as agent_name, c.name as club_origen_name
     FROM rakeback_advances ra
     JOIN agents a ON a.id = ra.agent_id
     LEFT JOIN clubs c ON c.id = ra.club_origen_id
     WHERE ra.active = true
     ORDER BY a.name, ra.created_at`
  );
  return r.rows;
}

export async function listAdvanceMovements(agentId?: string) {
  const where = agentId ? `WHERE m.agent_id = $1` : "";
  const values = agentId ? [agentId] : [];
  const r = await pool.query(
    `SELECT m.*, a.name as agent_name
     FROM rakeback_advance_movements m
     JOIN agents a ON a.id = m.agent_id
     ${where}
     ORDER BY m.occurred_at DESC
     LIMIT 500`,
    values
  );
  return r.rows;
}

/**
 * Da de alta un adelanto NUEVO e independiente — nunca reutiliza ni se fija si el agente ya
 * tiene otro(s) adelanto(s) activos, porque en la práctica un agente puede recibir varios
 * adelantos distintos en la misma semana, en clubes distintos.
 *
 * Si viene con medio (FICHAS/USDT), primero genera el movimiento real que mueve stock/wallet
 * (no corre dentro de la misma transacción que el alta local -- mismo criterio ya aceptado en
 * el resto de la app para este tipo de cruces, ver pagarPendiente en repo/rakebackPendiente.ts).
 */
export async function altaAdelanto(input: AltaAdelantoInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");
  if (input.medio && !input.clubOrigenId) {
    throw new Error("Un adelanto en fichas o USDT necesita club de origen (de dónde sale la plata/fichas).");
  }

  const id = newId("adv");
  let movementId: string | null = null;
  if (input.medio) {
    const reg = await registrarMovimientoLedger({
      idempotencyKey: `adv_alta:${id}`,
      // FICHAS = CARGA real (mueve el stock físico, se descuenta después en la liquidación).
      // USDT = tipo propio que sale de la wallet (entrada de tesorería) pero no toca el
      // balance/stock -- ver deltaParaBalance en repo/ledger.ts.
      type: input.medio === "FICHAS" ? "CARGA" : "ADELANTO_RAKEBACK",
      clubId: input.clubOrigenId!,
      agentId: input.agentId,
      amount: input.amount,
      paymentMethod: input.medio === "FICHAS" ? "SIN_TESORERIA" : "USDT",
      occurredAt: new Date(),
      observation: input.notes || `Adelanto de rakeback en ${input.medio === "FICHAS" ? "fichas" : "USDT"}.`,
      createdBy: input.createdBy ?? null,
      // El "pendiente de cobrar" ya lo trackea rakeback_advances (amount/consumed) -- no hace
      // falta además una nota de crédito de carga_pendientes_cruce para esto.
      sinNotaDeCredito: true,
    });
    movementId = reg.id;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `INSERT INTO rakeback_advances (id, agent_id, amount, consumed, active, club_origen_id, medio, notes) VALUES ($1,$2,$3,0,true,$4,$5,$6) RETURNING *`,
      [id, input.agentId, input.amount, input.clubOrigenId ?? null, input.medio ?? null, input.notes ?? null]
    );
    const advance = r.rows[0];
    await registrarMovimiento(client, advance, "ALTA", input.amount, input.notes, input.createdBy, movementId);
    await client.query("COMMIT");
    return advance;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Aumento/Reducción/Consumo/Baja sobre UN adelanto puntual (por id) — nunca "el adelanto del
 * agente", porque puede tener varios a la vez.
 *
 * Solo AUMENTO sobre un adelanto con medio (FICHAS/USDT) mueve stock/wallet de verdad, con un
 * movimiento adicional al mismo club de origen del Alta. Reducción/Consumo/Baja nunca generan
 * movimiento: Consumo es el descuento que ya se aplica aparte en la liquidación real (el stock
 * ya se movió en el Alta/Aumento), y Reducción/Baja corrigen cuánto se le sigue debiendo al
 * agente, no una devolución física de fichas/plata.
 */
export async function ajustarAdelanto(input: AjusteAdelantoInput) {
  if (input.amount < 0) throw new Error("El monto tiene que ser positivo — el tipo de movimiento ya define si suma o resta.");

  const existingForMov = await pool.query(`SELECT * FROM rakeback_advances WHERE id = $1 AND active = true`, [input.advanceId]);
  const actualParaMov = existingForMov.rows[0];
  if (!actualParaMov) throw new Error("No se encontró ese adelanto (o ya está dado de baja).");

  let movementId: string | null = null;
  if (input.type === "AUMENTO" && actualParaMov.medio) {
    if (!actualParaMov.club_origen_id) {
      throw new Error("Este adelanto no tiene club de origen cargado -- corregilo primero (botón \"Corregir\") antes de aumentarlo.");
    }
    const reg = await registrarMovimientoLedger({
      idempotencyKey: `adv_aumento:${newId("x")}`,
      type: actualParaMov.medio === "FICHAS" ? "CARGA" : "ADELANTO_RAKEBACK",
      clubId: actualParaMov.club_origen_id,
      agentId: actualParaMov.agent_id,
      amount: input.amount,
      paymentMethod: actualParaMov.medio === "FICHAS" ? "SIN_TESORERIA" : "USDT",
      occurredAt: new Date(),
      observation: input.notes || `Aumento de adelanto de rakeback en ${actualParaMov.medio === "FICHAS" ? "fichas" : "USDT"}.`,
      createdBy: input.createdBy ?? null,
      sinNotaDeCredito: true,
    });
    movementId = reg.id;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT * FROM rakeback_advances WHERE id = $1 AND active = true FOR UPDATE`,
      [input.advanceId]
    );
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese adelanto (o ya está dado de baja).");

    let nuevoAmount = Number(actual.amount);
    let nuevoConsumed = Number(actual.consumed);
    let nuevoActive = true;

    if (input.type === "AUMENTO") {
      nuevoAmount += input.amount;
    } else if (input.type === "REDUCCION") {
      nuevoAmount -= input.amount;
      if (nuevoAmount < 0) throw new Error("La reducción no puede dejar el adelanto en negativo.");
      if (nuevoAmount < nuevoConsumed) throw new Error("El adelanto no puede quedar por debajo de lo ya consumido.");
    } else if (input.type === "CONSUMO") {
      nuevoConsumed += input.amount;
      if (nuevoConsumed > nuevoAmount) throw new Error("El consumo no puede superar el monto total del adelanto.");
    } else if (input.type === "BAJA") {
      nuevoActive = false;
    }

    const r = await client.query(
      `UPDATE rakeback_advances SET amount=$1, consumed=$2, active=$3, notes=COALESCE($4, notes), updated_at=now()
       WHERE id=$5 RETURNING *`,
      [nuevoAmount, nuevoConsumed, nuevoActive, input.notes ?? null, actual.id]
    );
    const advance = r.rows[0];
    const advMovId = await registrarMovimiento(client, advance, input.type, input.amount, input.notes, input.createdBy, movementId);
    await client.query("COMMIT");
    // movementRowId (no confundir con el movimiento de ledger, que ya viaja aparte si medio lo
    // generó): el id de esta fila puntual en rakeback_advance_movements, para poder deshacer
    // ESTE ajuste puntual con eliminarMovimientoAdelanto -- ver uso en Liquidaciones.tsx.
    return { ...advance, movementRowId: advMovId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Corrige un error de carga (monto, consumido, club de origen y/o medio mal tipeados) pisando el
 * valor directamente — a diferencia de ajustarAdelanto (AUMENTO/REDUCCION/CONSUMO), que
 * representa un evento real de negocio, esto es "esto nunca debió cargarse así". A propósito NO
 * toca ningún movimiento de stock/wallet ya generado (si el medio estaba mal y hace falta
 * corregir el movimiento real también, hay que borrarlo -- ver eliminarMovimientoAdelanto -- y
 * cargar el adelanto de nuevo). Igual queda registrado en el historial (tipo CORRECCION, con el
 * detalle de qué cambió) para no romper la trazabilidad.
 */
export async function corregirAdelanto(input: CorreccionAdelantoInput) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM rakeback_advances WHERE id = $1 FOR UPDATE`, [input.advanceId]);
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese adelanto.");

    const nuevoAmount = input.amount ?? Number(actual.amount);
    const nuevoConsumed = input.consumed ?? Number(actual.consumed);
    if (nuevoAmount < 0 || nuevoConsumed < 0) throw new Error("Los montos no pueden ser negativos.");
    if (nuevoConsumed > nuevoAmount) throw new Error("El consumido no puede quedar por encima del monto total.");
    const nuevoClubOrigenId = input.clubOrigenId === undefined ? actual.club_origen_id : input.clubOrigenId;

    const r = await client.query(
      `UPDATE rakeback_advances SET amount=$1, consumed=$2, club_origen_id=$3, updated_at=now() WHERE id=$4 RETURNING *`,
      [nuevoAmount, nuevoConsumed, nuevoClubOrigenId, actual.id]
    );
    const advance = r.rows[0];
    let detalle = `Corrección: monto ${actual.amount} → ${nuevoAmount}, consumido ${actual.consumed} → ${nuevoConsumed}.`;
    if (input.notes?.trim()) detalle += ` Motivo: ${input.notes.trim()}`;
    await registrarMovimiento(client, advance, "CORRECCION", 0, detalle, input.createdBy, null);
    await client.query("COMMIT");
    return advance;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borrado real de un adelanto y todo su historial de movimientos — a diferencia de "Baja"
 * (BAJA, que lo desactiva pero deja todo el rastro), esto lo saca del todo. Pensado para
 * limpiar un adelanto que nunca debió cargarse (ej. duplicado, o cargado al agente equivocado).
 * Bloqueado si ya tiene algo consumido (mismo criterio que eliminarPendiente en
 * repo/rakebackPendiente.ts) -- si movió stock/wallet de verdad (medio FICHAS/USDT), también
 * deshace esos movimientos (del más nuevo al más viejo, ver eliminarMovimiento en ledger.ts).
 */
export async function eliminarAdelanto(advanceId: string) {
  const existing = await pool.query(`SELECT * FROM rakeback_advances WHERE id = $1`, [advanceId]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese adelanto.");
  if (Number(actual.consumed) > 0) {
    throw new Error("Este adelanto ya tiene consumo aplicado -- no se puede borrar.");
  }

  const movs = await pool.query(
    `SELECT movement_id FROM rakeback_advance_movements WHERE advance_id = $1 AND movement_id IS NOT NULL ORDER BY occurred_at DESC, id DESC`,
    [advanceId]
  );
  for (const row of movs.rows) {
    await eliminarMovimientoLedger(row.movement_id);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM rakeback_advance_movements WHERE advance_id = $1`, [advanceId]);
    const r = await client.query(`DELETE FROM rakeback_advances WHERE id = $1 RETURNING id`, [advanceId]);
    if (r.rowCount === 0) throw new Error("No se encontró ese adelanto.");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borra UN movimiento puntual del historial (ej. un Consumo cargado por error durante pruebas)
 * — a diferencia de eliminarAdelanto (que borra todo el adelanto), esto corrige un solo evento
 * sin perder el resto del historial. Solo se puede borrar el movimiento MÁS RECIENTE de ese
 * adelanto (mismo criterio que reabrir un período: deshacer siempre del más nuevo hacia atrás),
 * porque los movimientos posteriores ya quedaron con su resulting_amount/resulting_consumed
 * calculado asumiendo que este existía — borrar uno del medio los desincronizaría. La ALTA
 * tampoco se puede borrar sola (sería dejar el adelanto sin origen): para eso está "Eliminar"
 * sobre el adelanto completo. Si el movimiento tenía su propio movement_id (ALTA/AUMENTO con
 * medio FICHAS/USDT), primero deshace ese movimiento real (ver eliminarMovimiento en
 * ledger.ts) -- si eso falla (por ejemplo porque no es el más reciente de ese agente+club en
 * el ledger general), no se toca nada acá.
 */
export async function eliminarMovimientoAdelanto(movementId: string) {
  const movRes = await pool.query(`SELECT * FROM rakeback_advance_movements WHERE id = $1`, [movementId]);
  const mov = movRes.rows[0];
  if (!mov) throw new Error("No se encontró ese movimiento.");
  if (mov.type === "ALTA") {
    throw new Error("No se puede borrar la ALTA sola — para sacar el adelanto entero usá \"Eliminar\" sobre el adelanto.");
  }
  if (mov.movement_id) {
    await eliminarMovimientoLedger(mov.movement_id);
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const movRes2 = await client.query(`SELECT * FROM rakeback_advance_movements WHERE id = $1 FOR UPDATE`, [movementId]);
    const mov2 = movRes2.rows[0];
    if (!mov2) throw new Error("No se encontró ese movimiento.");

    const ultimo = await client.query(
      `SELECT id FROM rakeback_advance_movements WHERE advance_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov2.advance_id]
    );
    if (ultimo.rows[0]?.id !== movementId) {
      throw new Error("Solo se puede borrar el movimiento MÁS RECIENTE de este adelanto — borralos en orden, del más nuevo hacia atrás.");
    }

    const anterior = await client.query(
      `SELECT resulting_amount, resulting_consumed FROM rakeback_advance_movements
       WHERE advance_id = $1 AND id <> $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov2.advance_id, movementId]
    );
    const amount = anterior.rows[0] ? Number(anterior.rows[0].resulting_amount) : 0;
    const consumed = anterior.rows[0] ? Number(anterior.rows[0].resulting_consumed) : 0;

    await client.query(
      `UPDATE rakeback_advances SET amount=$1, consumed=$2, active=true, updated_at=now() WHERE id=$3`,
      [amount, consumed, mov2.advance_id]
    );
    await client.query(`DELETE FROM rakeback_advance_movements WHERE id = $1`, [movementId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function registrarMovimiento(
  client: PoolClient,
  advance: any,
  type: AdvanceMovementType,
  amount: number,
  notes: string | undefined,
  createdBy: string | undefined,
  movementId: string | null
) {
  const advMovId = newId("advmov");
  await client.query(
    `INSERT INTO rakeback_advance_movements (id, agent_id, advance_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      advMovId,
      advance.agent_id,
      advance.id,
      type,
      amount,
      advance.amount,
      advance.consumed,
      movementId,
      notes ?? null,
      createdBy ?? null,
    ]
  );
  // Devuelve el id de ESTE movimiento puntual (no el del ledger, que es movementId) -- lo usa
  // por ejemplo Liquidaciones para poder deshacer un CONSUMO recién aplicado sin tener que ir a
  // buscar el movimiento a mano en la pantalla de Adelantos (ver eliminarMovimientoAdelanto).
  return advMovId;
}
