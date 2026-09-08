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
