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
    const movId = newId("ccm");
    await client.query(
      `INSERT INTO carga_cruce_movements (id, carga_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
       VALUES ($1,$2,$3,'CONSUMO',$4,$5,$6,$7,$8)`,
      [movId, carga.id, carga.agent_id, input.amount, carga.amount, carga.consumed, input.notes ?? null, input.createdBy ?? null]
    );
    await client.query("COMMIT");
    // movementRowId: el id de ESTE cruce puntual en carga_cruce_movements, para poder
    // deshacerlo con eliminarMovimientoCarga sin ir a buscarlo a mano (ver uso en
    // Liquidaciones.tsx, botón "Deshacer último cruce").
    return { ...carga, movementRowId: movId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borra UN cruce (CONSUMO) puntual -- mismo criterio que eliminarMovimientoAdelanto en
 * repo/advances.ts: solo el más reciente de esa carga (si hay otro cruce encima, hay que
 * deshacer ese primero), y nunca la ALTA (esa nace sola del movimiento CARGA real -- para
 * deshacerla hay que borrar/revertir ese movimiento en Movimientos, no acá).
 */
export async function eliminarMovimientoCarga(movementId: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const movRes = await client.query(`SELECT * FROM carga_cruce_movements WHERE id = $1 FOR UPDATE`, [movementId]);
    const mov = movRes.rows[0];
    if (!mov) throw new Error("No se encontró ese cruce.");
    if (mov.type === "ALTA") {
      throw new Error("La ALTA de una carga no se borra desde acá -- se deshace revirtiendo o borrando el movimiento CARGA original en Movimientos.");
    }

    const ultimo = await client.query(
      `SELECT id FROM carga_cruce_movements WHERE carga_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov.carga_id]
    );
    if (ultimo.rows[0]?.id !== movementId) {
      throw new Error("Solo se puede deshacer el cruce MÁS RECIENTE de esta carga -- si aplicaste otro encima, deshacé ese primero.");
    }

    const anterior = await client.query(
      `SELECT resulting_consumed FROM carga_cruce_movements
       WHERE carga_id = $1 AND id <> $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov.carga_id, movementId]
    );
    const consumed = anterior.rows[0] ? Number(anterior.rows[0].resulting_consumed) : 0;

    await client.query(
      `UPDATE carga_pendientes_cruce SET consumed=$1, active=true, updated_at=now() WHERE id=$2`,
      [consumed, mov.carga_id]
    );
    await client.query(`DELETE FROM carga_cruce_movements WHERE id = $1`, [movementId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borrado real de una carga pendiente y todo su historial de cruces -- para cuando se cargó
 * mal (ej. de prueba, o al agente/club equivocado) y nunca debió existir. A diferencia de
 * "consumirCarga" (que representa un cruce real de negocio), esto la saca del todo, mismo
 * criterio que eliminarAdelanto() en repo/advances.ts.
 */
export async function eliminarCarga(cargaId: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM carga_cruce_movements WHERE carga_id = $1`, [cargaId]);
    const r = await client.query(`DELETE FROM carga_pendientes_cruce WHERE id = $1 RETURNING id`, [cargaId]);
    if (r.rowCount === 0) throw new Error("No se encontró esa carga pendiente.");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
