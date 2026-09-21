// Cruce de "cargas de tesorería" contra Liquidaciones (21/09/2026, pedido de Leo): cuando se
// carga un movimiento tipo CARGA (Cargar Movimiento), repo/ledger.ts abre automáticamente una
// fila en carga_pendientes_cruce (ver ahí, es la "ALTA") — este archivo solo se ocupa de
// LISTAR esas cargas pendientes por agente y de CONSUMIRLAS al cruzarlas en una liquidación,
// mismo mecanismo (amount/consumed) que rakeback_advances/repo/advances.ts, pero acá cada carga
// es 1 a 1 contra un movimiento puntual (no hay alta manual ni corrección desde acá — para
// arreglar un error de carga hay que corregir el movimiento original en Movimientos).
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";

export interface ConsumirCargaInput {
  cargaId: string;
  amount: number; // siempre positivo
  notes?: string;
  createdBy?: string;
}

// Todas las cargas pendientes (activas, con saldo) de una lista de agentes — puede haber varias
// por agente, en clubes distintos, igual que los adelantos.
export async function listCargasPendientesPorAgentes(agentIds: string[]) {
  if (agentIds.length === 0) return [];
  const r = await pool.query(
    `SELECT cpc.id, cpc.agent_id, cpc.club_id, cpc.amount, cpc.consumed,
            a.name as agent_name, c.name as club_name
     FROM carga_pendientes_cruce cpc
     JOIN agents a ON a.id = cpc.agent_id
     JOIN clubs c ON c.id = cpc.club_id
     WHERE cpc.agent_id = ANY($1::text[]) AND cpc.active = true AND cpc.amount > cpc.consumed
     ORDER BY a.name, cpc.created_at`,
    [agentIds]
  );
  return r.rows;
}

/**
 * Consume (parcial o totalmente) UNA carga pendiente puntual — mismo criterio que "Consumo"
 * sobre un adelanto de rakeback (repo/advances.ts ajustarAdelanto): nunca puede superar lo que
 * esa carga todavía tiene pendiente.
 */
export async function consumirCarga(input: ConsumirCargaInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT * FROM carga_pendientes_cruce WHERE id = $1 AND active = true FOR UPDATE`,
      [input.cargaId]
    );
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró esa carga pendiente (o ya está dada de baja).");

    const nuevoConsumed = Number(actual.consumed) + input.amount;
    if (nuevoConsumed > Number(actual.amount)) {
      throw new Error("El consumo no puede superar el monto total pendiente de esa carga.");
    }

    const r = await client.query(
      `UPDATE carga_pendientes_cruce SET consumed=$1, updated_at=now() WHERE id=$2 RETURNING *`,
      [nuevoConsumed, actual.id]
    );
    const carga = r.rows[0];
    await client.query(
      `INSERT INTO carga_cruce_movements (id, carga_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
       VALUES ($1,$2,$3,'CONSUMO',$4,$5,$6,$7,$8)`,
      [newId("ccm"), carga.id, carga.agent_id, input.amount, carga.amount, carga.consumed, input.notes ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    return carga;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
