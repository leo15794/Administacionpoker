// Cuentas de socios (equivalente a "Cuentas y memorias" de la planilla: Saldo Uriel,
// Compensación Juan, etc.) — plata de los SOCIOS de la empresa, sin relación con agentes ni
// clubes. A diferencia del resto del sistema (ledger inmutable, revertir en vez de borrar),
// acá el usuario pidió explícitamente poder editar y eliminar todo directo — "control 100%".
// Una cuenta es un nombre con saldo = suma de sus movimientos (monto libre, +/-).
import { pool, newId } from "../db/pool.js";

export type PartnerEntryCategory = "COMPENSACION" | "COMISION" | "PAGO" | "RETIRO" | "GASTO" | "AJUSTE" | "OTRO";

export interface PartnerAccountInput {
  name: string;
  description?: string;
}

export interface PartnerEntryInput {
  accountId: string;
  category: PartnerEntryCategory;
  concept: string;
  amount: number; // libre, +/- — quien carga decide el signo
  entryDate?: string; // YYYY-MM-DD, default hoy
  notes?: string;
}

// Todas las cuentas activas con su saldo (suma de movimientos) y cantidad de movimientos.
export async function listPartnerAccounts() {
  const r = await pool.query(
    `SELECT pa.*, COALESCE(SUM(e.amount), 0) as saldo, COUNT(e.id)::int as movimientos
     FROM partner_accounts pa
     LEFT JOIN partner_account_entries e ON e.account_id = pa.id
     WHERE pa.active = true
     GROUP BY pa.id
     ORDER BY pa.name`
  );
  return r.rows;
}

export async function crearCuenta(input: PartnerAccountInput) {
  if (!input.name.trim()) throw new Error("El nombre de la cuenta es obligatorio.");
  const id = newId("pacc");
  const r = await pool.query(
    `INSERT INTO partner_accounts (id, name, description) VALUES ($1,$2,$3) RETURNING *`,
    [id, input.name.trim(), input.description?.trim() || null]
  );
  return r.rows[0];
}

export async function editarCuenta(id: string, input: Partial<PartnerAccountInput>) {
  const r = await pool.query(
    `UPDATE partner_accounts SET
       name = COALESCE($1, name),
       description = CASE WHEN $2::boolean THEN $3 ELSE description END,
       updated_at = now()
     WHERE id = $4 RETURNING *`,
    [input.name?.trim() || null, input.description !== undefined, input.description?.trim() || null, id]
  );
  if (!r.rows[0]) throw new Error("No se encontró esa cuenta.");
  return r.rows[0];
}

// Borrado real — la cuenta y todos sus movimientos (ON DELETE CASCADE). Control total pedido
// explícitamente por el usuario para este módulo, a diferencia del resto del sistema.
export async function eliminarCuenta(id: string) {
  const r = await pool.query(`DELETE FROM partner_accounts WHERE id = $1 RETURNING id`, [id]);
  if (r.rowCount === 0) throw new Error("No se encontró esa cuenta.");
}

export async function listPartnerEntries(accountId?: string) {
  const where = accountId ? `WHERE e.account_id = $1` : "";
  const values = accountId ? [accountId] : [];
  const r = await pool.query(
    `SELECT e.*, pa.name as account_name
     FROM partner_account_entries e
     JOIN partner_accounts pa ON pa.id = e.account_id
     ${where}
     ORDER BY e.entry_date DESC, e.created_at DESC
     LIMIT 1000`,
    values
  );
  return r.rows;
}

export async function crearMovimiento(input: PartnerEntryInput) {
  if (!input.concept.trim()) throw new Error("El concepto es obligatorio.");
  if (!(input.amount !== 0)) throw new Error("El monto no puede ser 0.");
  const id = newId("pentry");
  const r = await pool.query(
    `INSERT INTO partner_account_entries (id, account_id, category, concept, amount, entry_date, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6, CURRENT_DATE),$7) RETURNING *`,
    [id, input.accountId, input.category, input.concept.trim(), input.amount, input.entryDate || null, input.notes?.trim() || null]
  );
  return r.rows[0];
}

export async function editarMovimiento(id: string, input: Partial<PartnerEntryInput>) {
  const existing = await pool.query(`SELECT * FROM partner_account_entries WHERE id = $1`, [id]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese movimiento.");
  if (input.amount !== undefined && input.amount === 0) throw new Error("El monto no puede ser 0.");
  const r = await pool.query(
    `UPDATE partner_account_entries SET
       category = COALESCE($1, category),
       concept = COALESCE($2, concept),
       amount = COALESCE($3, amount),
       entry_date = COALESCE($4, entry_date),
       notes = CASE WHEN $5::boolean THEN $6 ELSE notes END,
       updated_at = now()
     WHERE id = $7 RETURNING *`,
    [
      input.category ?? null,
      input.concept?.trim() || null,
      input.amount ?? null,
      input.entryDate || null,
      input.notes !== undefined,
      input.notes?.trim() || null,
      id,
    ]
  );
  return r.rows[0];
}

// Borrado real — control 100% pedido explícitamente por el usuario.
export async function eliminarMovimiento(id: string) {
  const r = await pool.query(`DELETE FROM partner_account_entries WHERE id = $1 RETURNING id`, [id]);
  if (r.rowCount === 0) throw new Error("No se encontró ese movimiento.");
}

/**
 * Agregados estilo "CONTROL_GANANCIAS" de la planilla — pero la ganancia operativa sale en vivo
 * de nuestros propios weekly_closings (todas las semanas con cierre real, no solo la última) en
 * vez de un histórico pegado a mano; los retiros/gastos/ajustes SÍ son manuales, cargados como
 * movimientos de cuenta con la categoría correspondiente, sin importar a qué cuenta pertenezcan.
 */
export async function getAgregadosSocios() {
  const ganancia = await pool.query(
    `SELECT COALESCE(SUM(rake_total - rakeback - rebate), 0) as ganancia_operativa
     FROM weekly_closings
     WHERE status <> 'REVERTIDO' AND rule_applied IS DISTINCT FROM 'RECONSTRUIDO_SIN_DESGLOSE'`
  );
  const porCategoria = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) as total
     FROM partner_account_entries
     WHERE category IN ('RETIRO','GASTO','AJUSTE')
     GROUP BY category`
  );
  const totales: Record<string, number> = { RETIRO: 0, GASTO: 0, AJUSTE: 0 };
  for (const row of porCategoria.rows) totales[row.category] = Number(row.total);

  const gananciaOperativa = Number(ganancia.rows[0].ganancia_operativa);
  const gananciaNeta = gananciaOperativa - totales.GASTO + totales.AJUSTE;
  const saldoDespuesRetiros = gananciaNeta - totales.RETIRO;

  return {
    gananciaOperativaHistorica: gananciaOperativa,
    retirosSocios: totales.RETIRO,
    gastosOperativos: totales.GASTO,
    ingresosAjustes: totales.AJUSTE,
    gananciaNetaHistorica: gananciaNeta,
    saldoDespuesRetiros,
  };
}
