import { pool, newId } from "../db/pool.js";

export interface NewTreasuryAdjustment {
  ledger: "WALLET_MANOS" | "CAJA_EFECTIVO";
  direction: "INGRESO" | "EGRESO";
  amount: number;
  custodian?: string | null; // obligatorio si ledger = CAJA_EFECTIVO
  reason: string;
  occurredAt?: Date;
  createdBy?: string | null;
  idempotencyKey?: string | null; // solo la usan las importaciones masivas
}

// Ajuste manual de tesorería: para cuando entra o sale plata de la wallet/caja que NO
// viene de un movimiento de agente (aporte propio, retiro de socio, diferencia de arqueo).
// A propósito NO toca balances ni ledger_movements: es un registro aparte que siempre
// aparece marcado como "ajuste manual" en el historial de tesorería, nunca mezclado con
// la proyección automática que generan los movimientos de agentes.
//
// Si viene idempotencyKey (lo usan los scripts de importación masiva) y ya existe una fila
// con esa clave, es un no-op — así un import se puede volver a correr sin duplicar nada.
export async function registrarAjusteTesoreria(input: NewTreasuryAdjustment) {
  if (input.ledger === "CAJA_EFECTIVO" && !input.custodian) {
    throw new Error("Un ajuste en efectivo requiere custodio.");
  }
  if (input.idempotencyKey) {
    const existing = await pool.query(`SELECT id FROM treasury_adjustments WHERE idempotency_key = $1`, [input.idempotencyKey]);
    if (existing.rows.length > 0) return { id: existing.rows[0].id, alreadyApplied: true };
  }
  const id = newId("tad");
  await pool.query(
    `INSERT INTO treasury_adjustments (id, ledger, direction, amount, custodian, reason, occurred_at, created_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.ledger,
      input.direction,
      Math.abs(input.amount),
      input.custodian ?? null,
      input.reason,
      input.occurredAt ?? new Date(),
      input.createdBy ?? null,
      input.idempotencyKey ?? null,
    ]
  );
  return { id, alreadyApplied: false };
}

export async function listTreasuryAdjustments(limit = 200) {
  const r = await pool.query(`SELECT * FROM treasury_adjustments ORDER BY occurred_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

/**
 * Revierte un ajuste de tesorería (manual o histórico importado) cargado por error. LEDGER
 * INMUTABLE: nunca se borra — se inserta un ajuste nuevo con la dirección invertida (mismo
 * ledger, mismo custodio, mismo monto) y el original queda marcado status=REVERTIDO para
 * siempre, visible en el historial. Es seguro llamarla dos veces con el mismo id: la segunda
 * vez tira error en vez de duplicar la reversa.
 */
export async function revertirAjusteTesoreria(id: string, motivo?: string, revertidoPor?: string | null) {
  const r = await pool.query(`SELECT * FROM treasury_adjustments WHERE id = $1 FOR UPDATE`, [id]);
  const original = r.rows[0];
  if (!original) return { found: false };
  if (original.status === "REVERTIDO") {
    throw new Error("Este ajuste ya fue revertido antes — no se puede revertir dos veces.");
  }

  const idReversa = newId("tad");
  await pool.query(
    `INSERT INTO treasury_adjustments (id, ledger, direction, amount, custodian, reason, occurred_at, created_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6, now(), $7, $8)`,
    [
      idReversa,
      original.ledger,
      original.direction === "INGRESO" ? "EGRESO" : "INGRESO",
      original.amount,
      original.custodian,
      `Reversión de ajuste ${id}${motivo ? `: ${motivo}` : "."} Original: "${original.reason}". El original queda en el historial marcado como revertido, nunca se borra.`,
      revertidoPor ?? null,
      `revert_${id}`,
    ]
  );
  await pool.query(`UPDATE treasury_adjustments SET status = 'REVERTIDO', reverted_by_id = $2 WHERE id = $1`, [id, idReversa]);
  return { found: true, id, idReversa };
}
