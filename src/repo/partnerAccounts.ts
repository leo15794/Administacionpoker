// Cuentas de socios (equivalente a "Cuentas y memorias" de la planilla: Saldo Uriel,
// Compensación Juan, etc.) — plata de los SOCIOS de la empresa, sin relación con agentes ni
// clubes. A diferencia del resto del sistema (ledger inmutable, revertir en vez de borrar),
// acá el usuario pidió explícitamente poder editar y eliminar todo directo — "control 100%".
// Una cuenta es un nombre con saldo = suma de sus movimientos (monto libre, +/-).
import { pool, newId } from "../db/pool.js";
import { getResumenClubSemanal } from "./clubResumen.js";

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function toFecha(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

export interface GananciaHistoricaAjusteInput {
  amount: number; // libre, +/- -- normalmente positivo (ganancia de antes de usar el sistema)
  concept: string;
  notes?: string;
}

// Ajustes a "Ganancia operativa histórica" (ver comentario en schema.sql) -- para arrancar ese
// número desde un total viejo (planilla pre-sistema) sin tocar el cálculo en vivo de los cierres
// reales que comparten Resumen ejecutivo / Resumen por club / Resumen financiero.
export async function listGananciaHistoricaAjustes() {
  const r = await pool.query(`SELECT * FROM ganancia_operativa_ajustes_historicos ORDER BY created_at DESC`);
  return r.rows;
}

export async function crearGananciaHistoricaAjuste(input: GananciaHistoricaAjusteInput, createdBy?: string) {
  if (!input.concept.trim()) throw new Error("El concepto es obligatorio.");
  if (!(input.amount !== 0)) throw new Error("El monto no puede ser 0.");
  const id = newId("ghaj");
  const r = await pool.query(
    `INSERT INTO ganancia_operativa_ajustes_historicos (id, amount, concept, notes, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, input.amount, input.concept.trim(), input.notes?.trim() || null, createdBy || null]
  );
  return r.rows[0];
}

export async function editarGananciaHistoricaAjuste(id: string, input: Partial<GananciaHistoricaAjusteInput>) {
  if (input.amount !== undefined && input.amount === 0) throw new Error("El monto no puede ser 0.");
  const r = await pool.query(
    `UPDATE ganancia_operativa_ajustes_historicos SET
       amount = COALESCE($1, amount),
       concept = COALESCE($2, concept),
       notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
       updated_at = now()
     WHERE id = $5 RETURNING *`,
    [input.amount ?? null, input.concept?.trim() || null, input.notes !== undefined, input.notes?.trim() || null, id]
  );
  if (!r.rows[0]) throw new Error("No se encontró ese ajuste.");
  return r.rows[0];
}

// Borrado real -- control 100% pedido explícitamente por el usuario, mismo criterio que el
// resto de este módulo.
export async function eliminarGananciaHistoricaAjuste(id: string) {
  const r = await pool.query(`DELETE FROM ganancia_operativa_ajustes_historicos WHERE id = $1 RETURNING id`, [id]);
  if (r.rowCount === 0) throw new Error("No se encontró ese ajuste.");
}

/**
 * Agregados estilo "CONTROL_GANANCIAS" de la planilla — pero la ganancia operativa sale en vivo
 * de nuestros propios weekly_closings (todas las semanas con cierre real, no solo la última) en
 * vez de un histórico pegado a mano; los retiros/gastos/ajustes SÍ son manuales, cargados como
 * movimientos de cuenta con la categoría correspondiente, sin importar a qué cuenta pertenezcan.
 *
 * IMPORTANTE (01/10/2026, bug reportado por Leo: esta pantalla mostraba US$10.948,35 de
 * "Ganancia operativa histórica" y ese número no coincidía con nada de Resumen financiero):
 * antes esto sumaba "rake_total - rakeback - rebate" directo de weekly_closings — una cuenta
 * vieja, propia de esta pantalla, DISTINTA a la que ya usan Resumen ejecutivo / Resumen por
 * club / Resumen financiero (getResumenClubSemanal: rake*ratio del club - rakeback + ganancia
 * de rodeo del club + ingreso por ventas + tasa semanal fija, con el override de Tiny). Esa
 * cuenta vieja ni aplicaba el ratio del club al rake, ni sumaba rodeo/ventas/tasa fija, y de
 * paso contaba semanas en BORRADOR (no solo aplicadas/corregidas). Ahora reusa
 * getResumenClubSemanal — la MISMA cuenta que ya usan esas pantallas — para que nunca vuelva a
 * mostrar un número distinto al de ahí.
 */
export async function getAgregadosSocios() {
  const clubesSemana = await pool.query(
    `SELECT DISTINCT club_id, week_start FROM weekly_closings WHERE status IN ('APLICADO','CORREGIDO')`
  );
  const resumenes = await Promise.all(
    clubesSemana.rows.map((r) => getResumenClubSemanal(r.club_id, toFecha(r.week_start)))
  );
  const gananciaCierres = resumenes.reduce((s, r) => s + (r ? Number(r.gananciaNeta) : 0), 0);

  // Ajustes históricos (planilla pre-sistema, ver tabla ganancia_operativa_ajustes_historicos) --
  // se suman arriba del cálculo en vivo SOLO acá, nunca en getResumenClubSemanal.
  const ajustesHistoricos = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM ganancia_operativa_ajustes_historicos`
  );
  const gananciaOperativa = round2(gananciaCierres + Number(ajustesHistoricos.rows[0].total));

  const porCategoria = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) as total
     FROM partner_account_entries
     WHERE category IN ('RETIRO','GASTO','AJUSTE')
     GROUP BY category`
  );
  const totales: Record<string, number> = { RETIRO: 0, GASTO: 0, AJUSTE: 0 };
  for (const row of porCategoria.rows) totales[row.category] = Number(row.total);

  const gananciaNeta = round2(gananciaOperativa - totales.GASTO + totales.AJUSTE);
  const saldoDespuesRetiros = round2(gananciaNeta - totales.RETIRO);

  return {
    gananciaOperativaHistorica: gananciaOperativa,
    retirosSocios: totales.RETIRO,
    gastosOperativos: totales.GASTO,
    ingresosAjustes: totales.AJUSTE,
    gananciaNetaHistorica: gananciaNeta,
    saldoDespuesRetiros,
  };
}
