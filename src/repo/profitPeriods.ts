import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";

// ============================================================
// AJUSTES EXTRAORDINARIOS
// ============================================================
// Pérdida/retención extraordinaria (fichas confiscadas, retención de club, etc.). La parte
// "absorbe_digiplayers" no se descuenta toda de una: se amortiza en `periodos_totales` cuotas
// iguales, una por cada período que se vaya cerrando (ver cerrarPeriodo). La última cuota
// siempre cobra el resto exacto (monto_total - lo ya aplicado) para no dejar centavos
// colgados por redondeo.

export type ModoDistribucion = "IGUAL_POR_PERIODO" | "PERSONALIZADO";

export interface AjusteExtraordinarioInput {
  occurredAt?: string;
  tipo: string;
  descripcion: string;
  responsable?: string | null;
  clubAgencia?: string | null;
  montoOriginal: number;
  absorbeDigiplayers?: number;
  absorbeAgente?: number;
  absorbeSupervisor?: number;
  modoDistribucion?: ModoDistribucion;
  periodosTotales?: number;
  afectadoTipo?: string | null;
  afectadoNombre?: string | null;
  observaciones?: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listAjustesExtraordinarios() {
  const r = await pool.query(`SELECT * FROM extraordinary_adjustments ORDER BY occurred_at DESC, created_at DESC`);
  return r.rows.map((row) => ({ ...row, proximaCuota: row.estado === "ACTIVO" && row.periodos_aplicados < row.periodos_totales ? calcularCuota(row) : 0 }));
}

// Cuánto se le descontaría a DigiPlayers si se cerrara un período AHORA MISMO con este ajuste
// todavía activo. periodos_aplicados ya refleja las cuotas consumidas hasta el momento.
function calcularCuota(adj: { absorbe_digiplayers: number | string; periodos_totales: number; periodos_aplicados: number }): number {
  const total = Number(adj.absorbe_digiplayers);
  const cuotaBase = total / adj.periodos_totales;
  const esUltima = adj.periodos_aplicados + 1 >= adj.periodos_totales;
  if (!esUltima) return round2(cuotaBase);
  return round2(total - cuotaBase * adj.periodos_aplicados);
}

export async function crearAjusteExtraordinario(input: AjusteExtraordinarioInput) {
  if (!input.descripcion.trim()) throw new Error("La descripción es obligatoria.");
  if (!(input.montoOriginal > 0)) throw new Error("El monto original tiene que ser mayor a 0.");
  const periodosTotales = input.modoDistribucion === "PERSONALIZADO" ? 1 : Math.max(1, input.periodosTotales ?? 1);
  const id = newId("ea");
  const r = await pool.query(
    `INSERT INTO extraordinary_adjustments
      (id, occurred_at, tipo, descripcion, responsable, club_agencia, monto_original,
       absorbe_digiplayers, absorbe_agente, absorbe_supervisor, modo_distribucion, periodos_totales,
       afectado_tipo, afectado_nombre, observaciones)
     VALUES ($1,COALESCE($2,CURRENT_DATE),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      id,
      input.occurredAt || null,
      input.tipo,
      input.descripcion.trim(),
      input.responsable?.trim() || null,
      input.clubAgencia?.trim() || null,
      input.montoOriginal,
      input.absorbeDigiplayers ?? 0,
      input.absorbeAgente ?? 0,
      input.absorbeSupervisor ?? 0,
      input.modoDistribucion ?? "IGUAL_POR_PERIODO",
      periodosTotales,
      input.afectadoTipo?.trim() || null,
      input.afectadoNombre?.trim() || null,
      input.observaciones?.trim() || null,
    ]
  );
  return r.rows[0];
}

export async function editarAjusteExtraordinario(id: string, input: Partial<AjusteExtraordinarioInput>) {
  const existing = await pool.query(`SELECT * FROM extraordinary_adjustments WHERE id = $1`, [id]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese ajuste.");
  // Los "totales" (períodos totales/aplicados, montos absorbidos) no se tocan libremente si ya
  // se aplicó alguna cuota — cambiar la base de cálculo a mitad de camino desarma la
  // contabilidad de lo que ya se descontó. Para eso hay que revertir los períodos que lo
  // consumieron primero (reabrirlos) y recién ahí editar.
  if (actual.periodos_aplicados > 0 && (input.montoOriginal !== undefined || input.absorbeDigiplayers !== undefined || input.periodosTotales !== undefined || input.modoDistribucion !== undefined)) {
    throw new Error(
      `Este ajuste ya tiene ${actual.periodos_aplicados} cuota(s) aplicada(s) en período(s) cerrados — no se puede cambiar el monto ni la cantidad de cuotas sin antes reabrir esos períodos.`
    );
  }
  const r = await pool.query(
    `UPDATE extraordinary_adjustments SET
       occurred_at = COALESCE($1, occurred_at),
       tipo = COALESCE($2, tipo),
       descripcion = COALESCE($3, descripcion),
       responsable = CASE WHEN $4::boolean THEN $5 ELSE responsable END,
       club_agencia = CASE WHEN $6::boolean THEN $7 ELSE club_agencia END,
       monto_original = COALESCE($8, monto_original),
       absorbe_digiplayers = COALESCE($9, absorbe_digiplayers),
       absorbe_agente = COALESCE($10, absorbe_agente),
       absorbe_supervisor = COALESCE($11, absorbe_supervisor),
       modo_distribucion = COALESCE($12, modo_distribucion),
       periodos_totales = COALESCE($13, periodos_totales),
       afectado_tipo = CASE WHEN $14::boolean THEN $15 ELSE afectado_tipo END,
       afectado_nombre = CASE WHEN $16::boolean THEN $17 ELSE afectado_nombre END,
       observaciones = CASE WHEN $18::boolean THEN $19 ELSE observaciones END,
       updated_at = now()
     WHERE id = $20 RETURNING *`,
    [
      input.occurredAt ?? null,
      input.tipo ?? null,
      input.descripcion?.trim() ?? null,
      input.responsable !== undefined, input.responsable?.trim() || null,
      input.clubAgencia !== undefined, input.clubAgencia?.trim() || null,
      input.montoOriginal ?? null,
      input.absorbeDigiplayers ?? null,
      input.absorbeAgente ?? null,
      input.absorbeSupervisor ?? null,
      input.modoDistribucion ?? null,
      input.periodosTotales ?? null,
      input.afectadoTipo !== undefined, input.afectadoTipo?.trim() || null,
      input.afectadoNombre !== undefined, input.afectadoNombre?.trim() || null,
      input.observaciones !== undefined, input.observaciones?.trim() || null,
      id,
    ]
  );
  return r.rows[0];
}

// Borrado real — control 100% (mismo criterio que Cuentas de socios). Si ya tenía cuotas
// aplicadas en períodos cerrados, esos períodos NO se recalculan solos (quedan con la foto que
// tenían al cerrarse) — solo se pierde el registro del ajuste en sí y sus filas de aplicación.
export async function eliminarAjusteExtraordinario(id: string) {
  const r = await pool.query(`DELETE FROM extraordinary_adjustments WHERE id = $1 RETURNING id`, [id]);
  if (r.rowCount === 0) throw new Error("No se encontró ese ajuste.");
}

// ============================================================
// PERÍODOS DE GANANCIAS
// ============================================================

async function computeGananciaOperativa(client: PoolClient, weekStarts: string[]) {
  const r = await client.query(
    `SELECT COALESCE(SUM(rake_total - rakeback - rebate), 0) as total
     FROM weekly_closings
     WHERE week_start = ANY($1::date[]) AND status <> 'REVERTIDO' AND rule_applied IS DISTINCT FROM 'RECONSTRUIDO_SIN_DESGLOSE'`,
    [weekStarts]
  );
  return Number(r.rows[0].total);
}

async function computeRangoFechas(client: PoolClient, weekStarts: string[]) {
  const r = await client.query(
    `SELECT MIN(week_start) as desde, MAX(week_end) as hasta FROM weekly_closings WHERE week_start = ANY($1::date[])`,
    [weekStarts]
  );
  return { desde: r.rows[0]?.desde ?? null, hasta: r.rows[0]?.hasta ?? null };
}

async function computeCategoriasSocios(client: PoolClient, desde: string | null, hasta: string | null) {
  if (!desde || !hasta) return { retiros: 0, gastos: 0, ingresosAjustes: 0 };
  const r = await client.query(
    `SELECT category, COALESCE(SUM(amount), 0) as total
     FROM partner_account_entries
     WHERE entry_date BETWEEN $1 AND $2 AND category IN ('RETIRO','GASTO','AJUSTE')
     GROUP BY category`,
    [desde, hasta]
  );
  const map: Record<string, number> = {};
  for (const row of r.rows) map[row.category] = Number(row.total);
  return {
    retiros: Math.abs(map.RETIRO ?? 0),
    gastos: Math.abs(map.GASTO ?? 0),
    ingresosAjustes: map.AJUSTE ?? 0,
  };
}

async function computeAjustesExtraordinariosPendientes(client: PoolClient) {
  const r = await client.query(
    `SELECT * FROM extraordinary_adjustments WHERE estado = 'ACTIVO' AND periodos_aplicados < periodos_totales ORDER BY occurred_at ASC`
  );
  const detalle = r.rows.map((row) => ({ id: row.id, descripcion: row.descripcion, cuota: calcularCuota(row) }));
  const total = detalle.reduce((acc, d) => acc + d.cuota, 0);
  return { total: round2(total), detalle };
}

/** Vista previa en vivo — nunca escribe nada. Sirve tanto para armar un período nuevo (elegir
 * semanas y ver cómo queda) como para ver qué pasaría si se cierra uno ya creado. */
export async function previewPeriodo(weekStarts: string[]) {
  const client = await pool.connect();
  try {
    const gananciaOperativa = await computeGananciaOperativa(client, weekStarts);
    const { desde, hasta } = await computeRangoFechas(client, weekStarts);
    const { retiros, gastos, ingresosAjustes } = await computeCategoriasSocios(client, desde, hasta);
    const gananciaAntesAjustesDp = gananciaOperativa - gastos + ingresosAjustes;
    const ajustes = await computeAjustesExtraordinariosPendientes(client);
    const gananciaNetaFinal = gananciaAntesAjustesDp - ajustes.total;
    return {
      gananciaOperativa,
      retiros,
      gastos,
      ingresosAjustes,
      gananciaAntesAjustesDp,
      ajustesExtraordinariosDp: ajustes.total,
      ajustesExtraordinariosDetalle: ajustes.detalle,
      gananciaNetaFinal,
      rangoFechas: { desde, hasta },
    };
  } finally {
    client.release();
  }
}

export async function listSemanasDisponibles() {
  const r = await pool.query(
    `SELECT DISTINCT week_start, week_end FROM weekly_closings WHERE status <> 'REVERTIDO' ORDER BY week_start DESC LIMIT 60`
  );
  return r.rows;
}

export async function listPeriodos() {
  const r = await pool.query(`SELECT * FROM profit_periods ORDER BY created_at DESC`);
  const periodos = r.rows;
  if (periodos.length === 0) return [];
  const semanasRes = await pool.query(
    `SELECT period_id, week_start FROM profit_period_weeks WHERE period_id = ANY($1::text[]) ORDER BY week_start`,
    [periodos.map((p) => p.id)]
  );
  const semanasPorPeriodo: Record<string, string[]> = {};
  for (const row of semanasRes.rows) {
    (semanasPorPeriodo[row.period_id] ??= []).push(row.week_start);
  }
  return periodos.map((p) => ({ ...p, semanas: semanasPorPeriodo[p.id] ?? [] }));
}

export async function getPeriodoDetalle(id: string) {
  const periodoRes = await pool.query(`SELECT * FROM profit_periods WHERE id = $1`, [id]);
  const periodo = periodoRes.rows[0];
  if (!periodo) return null;
  const semanasRes = await pool.query(`SELECT week_start FROM profit_period_weeks WHERE period_id = $1 ORDER BY week_start`, [id]);
  const semanas = semanasRes.rows.map((r) => r.week_start);
  const detalleRes = await pool.query(
    `SELECT wc.week_start, wc.week_end, c.name as club_name, (wc.rake_total - wc.rakeback - wc.rebate) as ganancia, wc.status
     FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE wc.week_start = ANY($1::date[]) AND wc.status <> 'REVERTIDO'
     ORDER BY wc.week_start, c.name`,
    [semanas]
  );
  const aplicacionesRes = await pool.query(
    `SELECT a.id, a.amount, e.descripcion, e.tipo
     FROM extraordinary_adjustment_applications a JOIN extraordinary_adjustments e ON e.id = a.adjustment_id
     WHERE a.period_id = $1 ORDER BY a.applied_at`,
    [id]
  );
  return { ...periodo, semanas, detalle: detalleRes.rows, ajustesAplicados: aplicacionesRes.rows };
}

export async function crearPeriodo(name: string, weekStarts: string[]) {
  if (!name.trim()) throw new Error("El nombre del período es obligatorio.");
  if (!weekStarts.length) throw new Error("Elegí al menos una semana.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = newId("pp");
    await client.query(`INSERT INTO profit_periods (id, name) VALUES ($1, $2)`, [id, name.trim()]);
    for (const ws of weekStarts) {
      await client.query(
        `INSERT INTO profit_period_weeks (id, period_id, week_start) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [newId("ppw"), id, ws]
      );
    }
    await client.query("COMMIT");
    return getPeriodoDetalle(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Solo se puede tocar el nombre/semanas mientras está ABIERTO — un período CERRADO es una foto
// histórica; para corregirle las semanas primero hay que reabrirlo (reabrirPeriodo).
export async function editarPeriodo(id: string, input: { name?: string; weekStarts?: string[] }) {
  const existing = await pool.query(`SELECT * FROM profit_periods WHERE id = $1`, [id]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese período.");
  if (actual.status === "CERRADO" && input.weekStarts !== undefined) {
    throw new Error("Este período ya está cerrado — reabrilo antes de cambiarle las semanas.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.name !== undefined) {
      await client.query(`UPDATE profit_periods SET name = $1 WHERE id = $2`, [input.name.trim(), id]);
    }
    if (input.weekStarts !== undefined) {
      await client.query(`DELETE FROM profit_period_weeks WHERE period_id = $1`, [id]);
      for (const ws of input.weekStarts) {
        await client.query(
          `INSERT INTO profit_period_weeks (id, period_id, week_start) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [newId("ppw"), id, ws]
        );
      }
    }
    await client.query("COMMIT");
    return getPeriodoDetalle(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Cierra el período: congela los números (calculados en vivo, igual que previewPeriodo) y
 * consume una cuota de cada ajuste extraordinario todavía activo. */
export async function cerrarPeriodo(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodoRes = await client.query(`SELECT * FROM profit_periods WHERE id = $1 FOR UPDATE`, [id]);
    const periodo = periodoRes.rows[0];
    if (!periodo) throw new Error("No se encontró ese período.");
    if (periodo.status === "CERRADO") throw new Error("Este período ya está cerrado.");

    const semanasRes = await client.query(`SELECT week_start FROM profit_period_weeks WHERE period_id = $1`, [id]);
    const weekStarts: string[] = semanasRes.rows.map((r) => r.week_start);
    if (!weekStarts.length) throw new Error("Este período no tiene semanas cargadas.");

    const gananciaOperativa = await computeGananciaOperativa(client, weekStarts);
    const { desde, hasta } = await computeRangoFechas(client, weekStarts);
    const { retiros, gastos, ingresosAjustes } = await computeCategoriasSocios(client, desde, hasta);
    const gananciaAntesAjustesDp = gananciaOperativa - gastos + ingresosAjustes;

    // Consume una cuota de cada ajuste activo con cuotas pendientes — en el mismo orden que
    // muestra la vista previa (occurred_at ascendente), así lo que se cierra coincide siempre
    // con lo que se mostró antes de apretar "Cerrar".
    const ajustesRes = await client.query(
      `SELECT * FROM extraordinary_adjustments WHERE estado = 'ACTIVO' AND periodos_aplicados < periodos_totales ORDER BY occurred_at ASC FOR UPDATE`
    );
    let ajustesExtraordinariosDp = 0;
    for (const adj of ajustesRes.rows) {
      const cuota = calcularCuota(adj);
      ajustesExtraordinariosDp += cuota;
      await client.query(
        `INSERT INTO extraordinary_adjustment_applications (id, adjustment_id, period_id, amount) VALUES ($1,$2,$3,$4)`,
        [newId("eaa"), adj.id, id, cuota]
      );
      const nuevosAplicados = adj.periodos_aplicados + 1;
      const nuevoEstado = nuevosAplicados >= adj.periodos_totales ? "FINALIZADO" : "ACTIVO";
      await client.query(
        `UPDATE extraordinary_adjustments SET periodos_aplicados = $1, estado = $2, updated_at = now() WHERE id = $3`,
        [nuevosAplicados, nuevoEstado, adj.id]
      );
    }
    ajustesExtraordinariosDp = round2(ajustesExtraordinariosDp);
    const gananciaNetaFinal = gananciaAntesAjustesDp - ajustesExtraordinariosDp;

    await client.query(
      `UPDATE profit_periods SET
        status = 'CERRADO', closed_at = now(),
        ganancia_operativa = $1, retiros = $2, gastos = $3, ingresos_ajustes = $4,
        ganancia_antes_ajustes_dp = $5, ajustes_extraordinarios_dp = $6, ganancia_neta_final = $7
       WHERE id = $8`,
      [gananciaOperativa, retiros, gastos, ingresosAjustes, gananciaAntesAjustesDp, ajustesExtraordinariosDp, gananciaNetaFinal, id]
    );

    await client.query("COMMIT");
    return getPeriodoDetalle(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Reabre un período cerrado: le devuelve la cuota consumida a cada ajuste que tocó (vuelve a
 * ACTIVO si estaba FINALIZADO) y borra el snapshot. OJO: asume que se reabre en orden inverso
 * al que se fue cerrando — reabrir un período viejo con otros más nuevos ya cerrados que
 * también consumieron cuotas del mismo ajuste deja el contador desincronizado (mismo caveat
 * que la memoria de bancados/rodeo en repo/closings.ts). */
export async function reabrirPeriodo(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodoRes = await client.query(`SELECT * FROM profit_periods WHERE id = $1 FOR UPDATE`, [id]);
    const periodo = periodoRes.rows[0];
    if (!periodo) throw new Error("No se encontró ese período.");
    if (periodo.status === "ABIERTO") throw new Error("Este período ya está abierto.");

    const aplicacionesRes = await client.query(`SELECT * FROM extraordinary_adjustment_applications WHERE period_id = $1`, [id]);
    for (const app of aplicacionesRes.rows) {
      await client.query(
        `UPDATE extraordinary_adjustments SET periodos_aplicados = GREATEST(0, periodos_aplicados - 1), estado = 'ACTIVO', updated_at = now() WHERE id = $1`,
        [app.adjustment_id]
      );
      await client.query(`DELETE FROM extraordinary_adjustment_applications WHERE id = $1`, [app.id]);
    }

    await client.query(
      `UPDATE profit_periods SET
        status = 'ABIERTO', closed_at = NULL,
        ganancia_operativa = NULL, retiros = NULL, gastos = NULL, ingresos_ajustes = NULL,
        ganancia_antes_ajustes_dp = NULL, ajustes_extraordinarios_dp = NULL, ganancia_neta_final = NULL
       WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");
    return getPeriodoDetalle(id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Borrado real (control 100%, igual que Cuentas de socios) — si estaba cerrado, primero
// deshace las cuotas consumidas (mismo camino que reabrirPeriodo) para no dejar ajustes
// extraordinarios con contadores huérfanos.
export async function eliminarPeriodo(id: string) {
  const periodoRes = await pool.query(`SELECT status FROM profit_periods WHERE id = $1`, [id]);
  if (!periodoRes.rows[0]) throw new Error("No se encontró ese período.");
  if (periodoRes.rows[0].status === "CERRADO") {
    await reabrirPeriodo(id);
  }
  await pool.query(`DELETE FROM profit_periods WHERE id = $1`, [id]);
}
