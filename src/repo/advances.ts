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
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";

export type AdvanceMovementType = "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA" | "CORRECCION";
export type AjusteMovementType = "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA";

export interface AltaAdelantoInput {
  agentId: string;
  amount: number;
  clubOrigenId?: string | null; // referencia informativa — de qué club salió ESTE adelanto
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
 */
export async function altaAdelanto(input: AltaAdelantoInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = newId("adv");
    const r = await client.query(
      `INSERT INTO rakeback_advances (id, agent_id, amount, consumed, active, club_origen_id, notes) VALUES ($1,$2,$3,0,true,$4,$5) RETURNING *`,
      [id, input.agentId, input.amount, input.clubOrigenId ?? null, input.notes ?? null]
    );
    const advance = r.rows[0];
    await registrarMovimiento(client, advance, "ALTA", input.amount, input.notes, input.createdBy);
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
 */
export async function ajustarAdelanto(input: AjusteAdelantoInput) {
  if (input.amount < 0) throw new Error("El monto tiene que ser positivo — el tipo de movimiento ya define si suma o resta.");
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
    await registrarMovimiento(client, advance, input.type, input.amount, input.notes, input.createdBy);
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
 * Corrige un error de carga (monto, consumido y/o club de origen mal tipeados) pisando el valor
 * directamente — a diferencia de ajustarAdelanto (AUMENTO/REDUCCION/CONSUMO), que representa un
 * evento real de negocio, esto es "esto nunca debió cargarse así". Igual queda registrado en el
 * historial (tipo CORRECCION, con el detalle de qué cambió) para no romper la trazabilidad.
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
    await registrarMovimiento(client, advance, "CORRECCION", 0, detalle, input.createdBy);
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
 */
export async function eliminarAdelanto(advanceId: string) {
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

async function registrarMovimiento(
  client: PoolClient,
  advance: any,
  type: AdvanceMovementType,
  amount: number,
  notes: string | undefined,
  createdBy: string | undefined
) {
  await client.query(
    `INSERT INTO rakeback_advance_movements (id, agent_id, advance_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      newId("advmov"),
      advance.agent_id,
      advance.id,
      type,
      amount,
      advance.amount,
      advance.consumed,
      notes ?? null,
      createdBy ?? null,
    ]
  );
}
