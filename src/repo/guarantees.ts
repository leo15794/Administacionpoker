import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";

export type GuaranteeMovementType = "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA";

export interface AjusteGarantiaInput {
  agentId: string;
  type: GuaranteeMovementType;
  amount: number; // siempre positivo — el signo lo decide el "type"
  notes?: string;
  createdBy?: string;
}

export async function listGuaranteesConAgente() {
  const r = await pool.query(
    `SELECT g.*, a.name as agent_name
     FROM guarantees g JOIN agents a ON a.id = g.agent_id
     WHERE g.active = true
     ORDER BY a.name`
  );
  return r.rows;
}

export async function getActiveGuarantee(agentId: string) {
  const r = await pool.query(
    `SELECT * FROM guarantees WHERE agent_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1`,
    [agentId]
  );
  return r.rows[0] ?? null;
}

export async function listGuaranteeMovements(agentId?: string) {
  const where = agentId ? `WHERE m.agent_id = $1` : "";
  const values = agentId ? [agentId] : [];
  const r = await pool.query(
    `SELECT m.*, a.name as agent_name
     FROM guarantee_movements m JOIN agents a ON a.id = m.agent_id
     ${where}
     ORDER BY m.occurred_at DESC
     LIMIT 500`,
    values
  );
  return r.rows;
}

/**
 * Aplica un alta/aumento/reducción/consumo/baja de garantía de forma atómica, dejando
 * registrado el movimiento en guarantee_movements. Nunca inserta una segunda fila activa
 * para el mismo agente — reutiliza la existente (UPDATE in-place) salvo en ALTA cuando
 * no hay ninguna, evitando el bug de doble conteo en el Resumen.
 */
export async function ajustarGarantia(input: AjusteGarantiaInput) {
  if (input.amount < 0) throw new Error("El monto tiene que ser positivo — el tipo de movimiento ya define si suma o resta.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT * FROM guarantees WHERE agent_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [input.agentId]
    );
    const actual = existing.rows[0] ?? null;

    if (input.type === "ALTA") {
      if (actual) throw new Error("El agente ya tiene una garantía activa — usá 'Aumentar' en vez de 'Alta', o dala de baja primero.");
      const id = newId("gua");
      const r = await client.query(
        `INSERT INTO guarantees (id, agent_id, amount, consumed, active, notes) VALUES ($1,$2,$3,0,true,$4) RETURNING *`,
        [id, input.agentId, input.amount, input.notes ?? null]
      );
      const guarantee = r.rows[0];
      await registrarMovimiento(client, guarantee, "ALTA", input.amount, input.notes, input.createdBy);
      await client.query("COMMIT");
      return guarantee;
    }

    if (!actual) throw new Error("El agente no tiene una garantía activa todavía — usá 'Alta' primero.");

    let nuevoAmount = Number(actual.amount);
    let nuevoConsumed = Number(actual.consumed);
    let nuevoActive = true;

    if (input.type === "AUMENTO") {
      nuevoAmount += input.amount;
    } else if (input.type === "REDUCCION") {
      nuevoAmount -= input.amount;
      if (nuevoAmount < 0) throw new Error("La reducción no puede dejar la garantía en negativo.");
      if (nuevoAmount < nuevoConsumed) throw new Error("La garantía no puede quedar por debajo de lo ya consumido.");
    } else if (input.type === "CONSUMO") {
      nuevoConsumed += input.amount;
      if (nuevoConsumed > nuevoAmount) throw new Error("El consumo no puede superar el monto total de la garantía.");
    } else if (input.type === "BAJA") {
      nuevoActive = false;
    }

    const r = await client.query(
      `UPDATE guarantees SET amount=$1, consumed=$2, active=$3, notes=COALESCE($4, notes), updated_at=now()
       WHERE id=$5 RETURNING *`,
      [nuevoAmount, nuevoConsumed, nuevoActive, input.notes ?? null, actual.id]
    );
    const guarantee = r.rows[0];
    await registrarMovimiento(client, guarantee, input.type, input.amount, input.notes, input.createdBy);
    await client.query("COMMIT");
    return guarantee;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function registrarMovimiento(
  client: PoolClient,
  guarantee: any,
  type: GuaranteeMovementType,
  amount: number,
  notes: string | undefined,
  createdBy: string | undefined
) {
  await client.query(
    `INSERT INTO guarantee_movements (id, agent_id, guarantee_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      newId("guamov"),
      guarantee.agent_id,
      guarantee.id,
      type,
      amount,
      guarantee.amount,
      guarantee.consumed,
      notes ?? null,
      createdBy ?? null,
    ]
  );
}
