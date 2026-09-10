// Adelantos de rakeback: mismo patrón que repo/guarantees.ts, por AGENTE (no agente+club —
// corregido 11/09/2026: un agente sigue generando rake en varios clubes a la vez, el adelanto
// se compensa contra el rakeback que sea, sin importar de qué club salga). club_origen_id
// (12/09/2026) es solo una referencia informativa de dónde se originó — nunca limita contra qué
// club se compensa.
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";

export type AdvanceMovementType = "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA" | "CORRECCION";

export interface AjusteAdelantoInput {
  agentId: string;
  type: AdvanceMovementType;
  amount: number; // siempre positivo — el signo lo decide el "type"
  notes?: string;
  createdBy?: string;
  clubOrigenId?: string | null; // solo se usa en ALTA — referencia informativa, no de scope
}

export interface CorreccionAdelantoInput {
  advanceId: string;
  amount?: number; // nuevo monto TOTAL (no delta) — omitir para no tocarlo
  consumed?: number; // nuevo consumido TOTAL (no delta) — omitir para no tocarlo
  clubOrigenId?: string | null; // omitir (undefined) para no tocarlo; null para borrarlo
  notes: string; // obligatorio: motivo de la corrección, queda en el historial
  createdBy?: string;
}

export async function listAdvancesConAgente() {
  const r = await pool.query(
    `SELECT ra.*, a.name as agent_name, c.name as club_origen_name
     FROM rakeback_advances ra
     JOIN agents a ON a.id = ra.agent_id
     LEFT JOIN clubs c ON c.id = ra.club_origen_id
     WHERE ra.active = true
     ORDER BY a.name`
  );
  return r.rows;
}

export async function getActiveAdvance(agentId: string) {
  const r = await pool.query(
    `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1`,
    [agentId]
  );
  return r.rows[0] ?? null;
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
 * Aplica un alta/aumento/reducción/consumo/baja de adelanto de forma atómica, dejando
 * registrado el movimiento en rakeback_advance_movements. Nunca inserta una segunda fila
 * activa para el mismo agente — reutiliza la existente (UPDATE in-place) salvo en ALTA
 * cuando no hay ninguna (mismo criterio que ajustarGarantia, para evitar doble conteo).
 */
export async function ajustarAdelanto(input: AjusteAdelantoInput) {
  if (input.type === "CORRECCION") throw new Error("Para corregir un error de carga usá 'Corregir', no 'Ajustar'.");
  if (input.amount < 0) throw new Error("El monto tiene que ser positivo — el tipo de movimiento ya define si suma o resta.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [input.agentId]
    );
    const actual = existing.rows[0] ?? null;

    if (input.type === "ALTA") {
      if (actual) throw new Error("Ese agente ya tiene un adelanto activo — usá 'Aumentar' en vez de 'Alta', o dalo de baja primero.");
      const id = newId("adv");
      const r = await client.query(
        `INSERT INTO rakeback_advances (id, agent_id, amount, consumed, active, club_origen_id, notes) VALUES ($1,$2,$3,0,true,$4,$5) RETURNING *`,
        [id, input.agentId, input.amount, input.clubOrigenId ?? null, input.notes ?? null]
      );
      const advance = r.rows[0];
      await registrarMovimiento(client, advance, "ALTA", input.amount, input.notes, input.createdBy);
      await client.query("COMMIT");
      return advance;
    }

    if (!actual) throw new Error("Ese agente no tiene un adelanto activo todavía — usá 'Alta' primero.");

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
    const detalle = `Corrección: monto ${actual.amount} → ${nuevoAmount}, consumido ${actual.consumed} → ${nuevoConsumed}. Motivo: ${input.notes}`;
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
