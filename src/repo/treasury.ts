import { pool, newId } from "../db/pool.js";

export interface NewTreasuryAdjustment {
  ledger: "WALLET_MANOS" | "CAJA_EFECTIVO";
  direction: "INGRESO" | "EGRESO";
  amount: number;
  custodian?: string | null; // obligatorio si ledger = CAJA_EFECTIVO
  reason: string;
  occurredAt?: Date;
  createdBy?: string | null;
}

// Ajuste manual de tesorería: para cuando entra o sale plata de la wallet/caja que NO
// viene de un movimiento de agente (aporte propio, retiro de socio, diferencia de arqueo).
// A propósito NO toca balances ni ledger_movements: es un registro aparte que siempre
// aparece marcado como "ajuste manual" en el historial de tesorería, nunca mezclado con
// la proyección automática que generan los movimientos de agentes.
export async function registrarAjusteTesoreria(input: NewTreasuryAdjustment) {
  if (input.ledger === "CAJA_EFECTIVO" && !input.custodian) {
    throw new Error("Un ajuste en efectivo requiere custodio.");
  }
  const id = newId("tad");
  await pool.query(
    `INSERT INTO treasury_adjustments (id, ledger, direction, amount, custodian, reason, occurred_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.ledger,
      input.direction,
      Math.abs(input.amount),
      input.custodian ?? null,
      input.reason,
      input.occurredAt ?? new Date(),
      input.createdBy ?? null,
    ]
  );
  return { id };
}

export async function listTreasuryAdjustments(limit = 200) {
  const r = await pool.query(`SELECT * FROM treasury_adjustments ORDER BY occurred_at DESC LIMIT $1`, [limit]);
  return r.rows;
}
