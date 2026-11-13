import { pool, newId } from "../db/pool.js";

// Cuentas de tesorería. ZELLE (13/11/2026, mockup 93): saldo en USD aparte de la wallet de USDT.
export type LedgerTesoreria = "WALLET_MANOS" | "CAJA_EFECTIVO" | "ZELLE";
export const NOMBRE_LEDGER: Record<string, string> = { WALLET_MANOS: "USDT", ZELLE: "Zelle", CAJA_EFECTIVO: "Caja efectivo" };

/** Ledger de tesorería que corresponde a un medio de pago real (USDT, Zelle, efectivo). */
export function ledgerDeMedio(medio: string): LedgerTesoreria {
  return medio === "EFECTIVO" ? "CAJA_EFECTIVO" : medio === "ZELLE" ? "ZELLE" : "WALLET_MANOS";
}

// El CHECK de ledger admite ZELLE y treasury_adjustments tiene pase_id (ver schema.sql). Se aplica sola una vez por proceso, desde
// asegurarSchemaSesiones (lib/sesiones.ts), que corre antes de cualquier pedido con sesión.
let schemaTesoreria: Promise<void> | null = null;
export function asegurarSchemaTesoreria(): Promise<void> {
  schemaTesoreria ??= pool.query(`DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conrelid::regclass::text AS tabla, conname FROM pg_constraint
    WHERE contype = 'c' AND conrelid IN ('treasury_entries'::regclass, 'treasury_adjustments'::regclass)
      AND pg_get_constraintdef(oid) LIKE '%CAJA_EFECTIVO%' AND pg_get_constraintdef(oid) NOT LIKE '%ZELLE%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tabla, c.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (ledger IN (''WALLET_MANOS'',''CAJA_EFECTIVO'',''ZELLE''))', c.tabla, c.conname);
  END LOOP;
END $$;
ALTER TABLE treasury_adjustments ADD COLUMN IF NOT EXISTS pase_id TEXT;`).then(() => undefined).catch((e) => { schemaTesoreria = null; throw e; });
  return schemaTesoreria;
}

export interface NewTreasuryAdjustment {
  ledger: LedgerTesoreria;
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

// Saldo neto de la Wallet (WALLET_MANOS): mismo cálculo que ya usa el dashboard principal
// (ver routes/dashboard.ts, KPI "saldoWallet") -- se saca acá como función reusable para que
// TeamBack Affiliates pueda "espejarlo" en modo SOLO LECTURA (09/10/2026, pedido de Leo:
// "podemos poner en espejo la wallet de adm poker... en modo espejo") sin duplicar la query a
// mano. Suma ingresos/egresos de treasury_entries (lo que generan automático los pagos/cobros
// a agentes) + treasury_adjustments (ajustes manuales), filtrado al ledger WALLET_MANOS.
export async function getSaldoWalletNeto(): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS'
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS'
     ) t`
  );
  return Number(r.rows[0].neto);
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
  // Un pase entre USDT y Zelle son dos ajustes: revertir uno revierte el otro (no puede quedar un solo lado).
  if (original.pase_id) {
    const otros = await pool.query(
      `SELECT id FROM treasury_adjustments WHERE pase_id = $1 AND id <> $2 AND status <> 'REVERTIDO'`,
      [original.pase_id, id]
    );
    for (const o of otros.rows) await revertirAjusteTesoreria(o.id, motivo ? `${motivo} (otro lado del pase)` : "Otro lado del pase.", revertidoPor);
  }
  return { found: true, id, idReversa };
}

export interface PaseEntreCuentasInput {
  desde: "WALLET_MANOS" | "ZELLE";
  hacia: "WALLET_MANOS" | "ZELLE";
  montoSale: number;
  montoEntra: number;
  motivo?: string;
  occurredAt?: Date;
  createdBy?: string | null;
}

const fmt2 = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Mover entre USDT y Zelle" (13/11/2026, mockup 93): egreso en una cuenta e ingreso en la otra, con el mismo pase_id. Los montos pueden
 * ser distintos (cambio o comisión): la diferencia queda anotada en el motivo de los dos lados. No es ingreso ni gasto de la empresa.
 */
export async function registrarPaseEntreCuentas(input: PaseEntreCuentasInput) {
  await asegurarSchemaTesoreria();
  if (input.desde === input.hacia) throw new Error("Elegí cuentas distintas para mover.");
  const sale = Math.abs(Number(input.montoSale));
  const entra = Math.abs(Number(input.montoEntra));
  if (!sale || !entra) throw new Error("Poné cuánto sale y cuánto entra.");
  const de = NOMBRE_LEDGER[input.desde];
  const a = NOMBRE_LEDGER[input.hacia];
  const dif = Math.round((sale - entra) * 100) / 100;
  const nota = input.motivo?.trim() ? ` — ${input.motivo.trim()}` : "";
  const difTxt = dif !== 0 ? `; diferencia ${fmt2(dif)}` : "";
  const paseId = newId("pase");
  const cuando = input.occurredAt ?? new Date();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids: string[] = [];
    for (const lado of [
      { ledger: input.desde, direction: "EGRESO", amount: sale, reason: `Movido a ${a}${nota} (entraron ${fmt2(entra)} en ${a}${difTxt})` },
      { ledger: input.hacia, direction: "INGRESO", amount: entra, reason: `Recibido desde ${de}${nota} (salieron ${fmt2(sale)} de ${de}${difTxt})` },
    ]) {
      const id = newId("tad");
      ids.push(id);
      await client.query(
        `INSERT INTO treasury_adjustments (id, ledger, direction, amount, reason, occurred_at, created_by, pase_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, lado.ledger, lado.direction, lado.amount, lado.reason, cuando, input.createdBy ?? null, paseId]
      );
    }
    await client.query("COMMIT");
    return { paseId, ids, diferencia: dif };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
