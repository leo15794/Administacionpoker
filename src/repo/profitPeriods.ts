import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";
import { computeGananciaCierresYBancadosPorSemanas } from "./resumenFinanciero.js";
import { getResumenClubSemanal } from "./clubResumen.js";
import { MONTO_CATEGORIA_SQL } from "./partnerAccounts.js";
import { asegurarTablaSueldosManos, calcularSueldoManos, generarSueldoEnCierre, getSueldoDePeriodo } from "./sueldoManos.js";

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

// Corregido 02/10/2026 (pedido de Leo: "que ganancia por período tome la información tal cual
// como está en resumen financiero"): antes esto sumaba rake_total - rakeback - rebate directo
// de weekly_closings (sin bancados, y sin pasar por getResumenClubSemanal) -- una cuenta propia
// que podía no coincidir con lo que ya mostraba Resumen financiero para esas mismas semanas.
// Ahora llama a la MISMA función que usa esa pantalla, así "ganancia operativa" de un período es
// exactamente gananciaCierres + gananciaBancados de Resumen financiero para esas semanas, nunca
// un número distinto. client no se usa (el helper lee de pool) porque getResumenClubSemanal ya
// hace lo mismo -- son filas ya commiteadas de antes de que el período las referencie.
async function computeGananciaOperativa(client: PoolClient, weekStarts: string[]) {
  return computeGananciaCierresYBancadosPorSemanas(weekStarts);
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
    `SELECT category, COALESCE(SUM(${MONTO_CATEGORIA_SQL}), 0) as total
     FROM partner_account_entries
     WHERE entry_date BETWEEN $1 AND $2 AND category IN ('RETIRO','GASTO','AJUSTE')
     GROUP BY category`,
    [desde, hasta]
  );
  const map: Record<string, number> = {};
  for (const row of r.rows) map[row.category] = Number(row.total);
  // Mismo criterio que getAgregadosSocios (Cuentas de socios): retiros y gastos siempre restan,
  // se hayan cargado en positivo o en negativo (ver MONTO_CATEGORIA_SQL).
  return {
    retiros: map.RETIRO ?? 0,
    gastos: map.GASTO ?? 0,
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
    const { gananciaOperativa, gananciaCierres, gananciaBancados } = await computeGananciaOperativa(client, weekStarts);
    const { desde, hasta } = await computeRangoFechas(client, weekStarts);
    const { retiros, gastos, ingresosAjustes } = await computeCategoriasSocios(client, desde, hasta);
    const gananciaAntesAjustesDp = gananciaOperativa - gastos + ingresosAjustes;
    const ajustes = await computeAjustesExtraordinariosPendientes(client);
    const gananciaNetaFinal = gananciaAntesAjustesDp - ajustes.total;
    return {
      gananciaOperativa,
      gananciaCierres,
      gananciaBancados,
      retiros,
      gastos,
      ingresosAjustes,
      gananciaAntesAjustesDp,
      ajustesExtraordinariosDp: ajustes.total,
      ajustesExtraordinariosDetalle: ajustes.detalle,
      gananciaNetaFinal,
      // Vista previa del sueldo de Manos -- no se guarda nada hasta cerrar el período.
      sueldoManos: calcularSueldoManos(gananciaNetaFinal),
      rangoFechas: { desde, hasta },
    };
  } finally {
    client.release();
  }
}

// ============================================================
// REVISIÓN ANTES DE CERRAR (03/11/2026, pedido de Leo: "debería haber un paso previo para
// analizar si está todo bien"). Solo lee: arma los números que se van a congelar y una lista de
// chequeos. Una alerta no bloquea el cierre -- la pantalla pide confirmar que se revisaron.
// ============================================================

export interface ChequeoCierre {
  id: string;
  titulo: string;
  estado: "OK" | "ALERTA";
  resumen: string;
  items: string[];
}

const DIAS_CERCA_DEL_RANGO = 10;

export async function revisionCierrePeriodo(id: string) {
  await asegurarTablaSueldosManos();
  const periodoRes = await pool.query(`SELECT * FROM profit_periods WHERE id = $1`, [id]);
  const periodo = periodoRes.rows[0];
  if (!periodo) throw new Error("No se encontró ese período.");
  const semanasRes = await pool.query(`SELECT week_start::text AS ws FROM profit_period_weeks WHERE period_id = $1 ORDER BY week_start`, [id]);
  const semanas: string[] = semanasRes.rows.map((r) => r.ws);
  if (!semanas.length) throw new Error("Este período no tiene semanas cargadas.");

  const numeros = await previewPeriodo(semanas);
  const desde = numeros.rangoFechas.desde ? toFechaStr(numeros.rangoFechas.desde) : null;
  const hasta = numeros.rangoFechas.hasta ? toFechaStr(numeros.rangoFechas.hasta) : null;
  const chequeos: ChequeoCierre[] = [];
  const fmt = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  // --- Semanas -------------------------------------------------------------
  {
    const items: string[] = [];
    const ultima = semanas[semanas.length - 1];
    const sueltas = await pool.query(
      `SELECT DISTINCT wc.week_start::text AS ws FROM weekly_closings wc
       WHERE wc.status <> 'REVERTIDO' AND wc.week_start <= $1::date
         AND NOT EXISTS (SELECT 1 FROM profit_period_weeks w WHERE w.week_start = wc.week_start)
       ORDER BY 1`,
      [ultima]
    );
    for (const r of sueltas.rows) items.push(`La semana del ${dm(r.ws)} tiene cierres y no está en ningún período.`);
    const compartidas = await pool.query(
      `SELECT w.week_start::text AS ws, p.name FROM profit_period_weeks w JOIN profit_periods p ON p.id = w.period_id
       WHERE w.period_id <> $1 AND w.week_start = ANY($2::date[]) ORDER BY 1`,
      [id, semanas]
    );
    for (const r of compartidas.rows) items.push(`La semana del ${dm(r.ws)} también está en "${r.name}": se contaría dos veces.`);
    for (const ws of semanas) {
      if (new Date(ws + "T00:00:00Z").getUTCDay() !== 1) items.push(`La semana del ${dm(ws)} no empieza un lunes.`);
    }
    const sinCierres = await pool.query(
      `SELECT s.ws::text AS ws FROM unnest($1::date[]) AS s(ws)
       WHERE NOT EXISTS (SELECT 1 FROM weekly_closings wc WHERE wc.week_start = s.ws AND wc.status <> 'REVERTIDO')`,
      [semanas]
    );
    for (const r of sinCierres.rows) items.push(`La semana del ${dm(r.ws)} no tiene ningún cierre.`);
    chequeos.push({
      id: "semanas",
      titulo: "Semanas del período",
      estado: items.length ? "ALERTA" : "OK",
      resumen: `${semanas.length} semanas: ${semanas.map(dm).join(", ")}${desde && hasta ? ` (del ${dm(desde)} al ${dm(hasta)})` : ""}.`,
      items,
    });
  }

  // --- Cierres semanales y de proveedores ---------------------------------
  {
    const items: string[] = [];
    const borradores = await pool.query(
      `SELECT wc.week_start::text AS ws, c.name AS club, COUNT(*)::int AS n FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
       WHERE wc.status = 'BORRADOR' AND wc.week_start = ANY($1::date[])
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [semanas]
    );
    for (const r of borradores.rows) items.push(`${r.club}, semana del ${dm(r.ws)}: ${r.n} cierre${r.n === 1 ? "" : "s"} en borrador (no suman a la ganancia).`);
    const aplicados = await pool.query(
      `SELECT COUNT(*)::int AS n FROM weekly_closings WHERE status IN ('APLICADO','CORREGIDO') AND week_start = ANY($1::date[])`,
      [semanas]
    );
    // Proveedores que cierran en este tramo (o en las 4 semanas anteriores) y les falta alguna semana.
    const faltantesProv = await pool.query(
      `WITH activos AS (
         SELECT DISTINCT pc.proveedor_id FROM proveedor_cierres pc
         WHERE pc.status = 'APLICADO' AND pc.week_start BETWEEN ($1::date - 28) AND $2::date
       )
       SELECT p.name, s.ws::text AS ws
       FROM activos a JOIN proveedores p ON p.id = a.proveedor_id AND p.active
       CROSS JOIN unnest($3::date[]) AS s(ws)
       WHERE NOT EXISTS (SELECT 1 FROM proveedor_cierres pc WHERE pc.proveedor_id = a.proveedor_id AND pc.week_start = s.ws AND pc.status = 'APLICADO')
       ORDER BY 1, 2`,
      [semanas[0], semanas[semanas.length - 1], semanas]
    );
    const porProv: Record<string, string[]> = {};
    for (const r of faltantesProv.rows) (porProv[r.name] ??= []).push(dm(r.ws));
    for (const [nombre, ws] of Object.entries(porProv)) items.push(`Proveedor ${nombre}: sin cierre aplicado la${ws.length === 1 ? "" : "s"} semana${ws.length === 1 ? "" : "s"} del ${ws.join(", ")}.`);
    chequeos.push({
      id: "cierres",
      titulo: "Cierres semanales y de proveedores",
      estado: items.length ? "ALERTA" : "OK",
      resumen: `${aplicados.rows[0].n} cierres semanales aplicados en estas semanas.`,
      items,
    });
  }

  // --- Movimientos de socios ----------------------------------------------
  const movimientosRes = desde && hasta
    ? await pool.query(
        `SELECT e.id, a.name AS cuenta, e.category, e.concept, e.amount, e.entry_date::text AS fecha
         FROM partner_account_entries e JOIN partner_accounts a ON a.id = e.account_id
         WHERE e.category IN ('RETIRO','GASTO','AJUSTE') AND e.entry_date BETWEEN $1 AND $2
         ORDER BY e.entry_date, e.created_at`,
        [desde, hasta]
      )
    : { rows: [] as any[] };
  const movimientos = movimientosRes.rows.map((m) => ({ ...m, amount: Number(m.amount), fecha: String(m.fecha).slice(0, 10) }));
  {
    const items: string[] = [];
    for (const m of movimientos) {
      // Un Retiro en negativo es un "Retiro socio" (botón de Cuentas de socios, 12/11/2026): va en negativo a propósito.
      if (m.category === "GASTO" && m.amount < 0) {
        items.push(`${dm(m.fecha)} "${m.concept}" (${m.cuenta}) está como ${m.category.toLowerCase()} en negativo (${fmt(m.amount)}): cuenta igual como salida de ${fmt(Math.abs(m.amount))}.`);
      }
      if (/sueldo/i.test(m.concept)) {
        items.push(`${dm(m.fecha)} "${m.concept}" (${m.cuenta}) parece un sueldo cargado a mano: el sueldo de Manos ya lo descuenta el período, se restaría dos veces.`);
      }
    }
    if (desde && hasta) {
      const cerca = await pool.query(
        `SELECT a.name AS cuenta, e.category, e.concept, e.amount, e.entry_date::text AS fecha
         FROM partner_account_entries e JOIN partner_accounts a ON a.id = e.account_id
         WHERE e.category IN ('RETIRO','GASTO','AJUSTE')
           AND ((e.entry_date > $2::date AND e.entry_date <= $2::date + $3::int) OR (e.entry_date < $1::date AND e.entry_date >= $1::date - $3::int))
           AND NOT EXISTS (
             SELECT 1 FROM profit_periods p
             JOIN LATERAL (SELECT MIN(w.week_start) AS d, MAX(w.week_start) + 6 AS h FROM profit_period_weeks w WHERE w.period_id = p.id) r ON TRUE
             WHERE p.id <> $4 AND e.entry_date BETWEEN r.d AND r.h
           )
         ORDER BY e.entry_date`,
        [desde, hasta, DIAS_CERCA_DEL_RANGO, id]
      );
      for (const m of cerca.rows) {
        items.push(`${dm(String(m.fecha).slice(0, 10))} "${m.concept}" (${m.cuenta}, ${m.category.toLowerCase()} ${fmt(Number(m.amount))}) queda fuera del rango y de cualquier otro período: no entra en ninguno.`);
      }
    }
    chequeos.push({
      id: "movimientos",
      titulo: "Gastos, ajustes y retiros de socios",
      estado: items.length ? "ALERTA" : "OK",
      resumen: `${movimientos.length} movimientos en el rango: gastos ${fmt(numeros.gastos)}, ingresos/ajustes ${fmt(numeros.ingresosAjustes)}, retiros ${fmt(numeros.retiros)} (los retiros no restan de la ganancia del período).`,
      items,
    });
  }

  // --- Sueldo de Manos y ajustes extraordinarios -------------------------
  {
    const items: string[] = [];
    const s = numeros.sueldoManos;
    const diez = round2(s.base * s.porcentaje);
    const pendientes = await pool.query(
      `SELECT period_name, estado, sueldo_usdt FROM manos_sueldos WHERE period_id <> $1 AND estado <> 'PAGADO' ORDER BY generado_at`,
      [id]
    );
    const estados: Record<string, string> = { PENDIENTE: "sin pagar", REVISAR_DIFERENCIA: "con una diferencia por revisar", REQUIERE_REVISION: "que requiere revisión" };
    for (const r of pendientes.rows) items.push(`El sueldo de "${r.period_name}" (${fmt(Number(r.sueldo_usdt))}) está ${estados[r.estado] ?? r.estado}.`);
    const existente = await getSueldoDePeriodo(id);
    if (existente && existente.estado !== "PENDIENTE") {
      items.push(`Este período ya tiene un sueldo ${existente.estado === "PAGADO" ? "pagado" : "registrado"} de ${fmt(Number(existente.sueldo_usdt))}: si el importe cambia, va a quedar para revisar.`);
    }
    if (s.base < 0) items.push(`La ganancia neta final es negativa: igual se genera el mínimo de ${fmt(s.minimo)}.`);
    const ajustes = numeros.ajustesExtraordinariosDetalle.map((a: any) => `${a.descripcion}: ${fmt(a.cuota)}`);
    chequeos.push({
      id: "sueldo",
      titulo: "Sueldo de Manos y ajustes extraordinarios",
      estado: items.length ? "ALERTA" : "OK",
      resumen:
        `Sueldo ${fmt(s.sueldo)} (${s.aplicaMinimo ? `10% = ${fmt(diez)}, se aplica el mínimo de ${fmt(s.minimo)}` : `10% de ${fmt(s.base)}`}); quedan ${fmt(s.gananciaDisponibleSocios)} para socios. ` +
        (ajustes.length ? `Cuotas de ajustes DP que se consumen: ${ajustes.join(" · ")}.` : "No se consume ninguna cuota de ajustes DP."),
      items,
    });
  }

  return { periodo: { id: periodo.id, name: periodo.name, status: periodo.status }, numeros, chequeos, movimientos };
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

function toFechaStr(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}
function sumarDias(fechaIso: string, dias: number): string {
  const d = new Date(fechaIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export async function getPeriodoDetalle(id: string) {
  const periodoRes = await pool.query(`SELECT * FROM profit_periods WHERE id = $1`, [id]);
  const periodo = periodoRes.rows[0];
  if (!periodo) return null;
  const semanasRes = await pool.query(`SELECT week_start FROM profit_period_weeks WHERE period_id = $1 ORDER BY week_start`, [id]);
  const semanas = semanasRes.rows.map((r) => r.week_start);

  // Detalle por semana y club (corregido 02/10/2026, mismo motivo que computeGananciaOperativa
  // más arriba): antes mostraba (rake_total - rakeback - rebate) por cierre individual de
  // agente -- una cuenta vieja que no coincidía con "Ganancia cierres" de Resumen financiero.
  // Ahora muestra la MISMA Ganancia Neta por club+semana (getResumenClubSemanal) que ya se ve
  // ahí, más una fila aparte por cada ganancia de banca -- la suma de esta tabla ahora sí cierra
  // con ganancia_cierres + ganancia_bancados de arriba.
  const clubesSemanaRes = await pool.query(
    `SELECT DISTINCT club_id, week_start FROM weekly_closings
     WHERE status IN ('APLICADO','CORREGIDO') AND week_start = ANY($1::date[])
     ORDER BY week_start`,
    [semanas]
  );
  const resumenesClubSemana = await Promise.all(
    clubesSemanaRes.rows.map((r) => getResumenClubSemanal(r.club_id, toFechaStr(r.week_start)))
  );
  const detalleCierres = resumenesClubSemana
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      week_start: r.weekStart,
      week_end: sumarDias(r.weekStart, 6),
      club_name: r.clubName,
      ganancia: r.gananciaNeta,
      tipo: "CIERRE" as const,
    }));

  const bancadosRes = await pool.query(
    `SELECT h.week_start, c.name as club_name, h.ganancia_banca_mesas, p.display_name as player_name
     FROM bancado_historial h JOIN clubs c ON c.id = h.club_id JOIN players p ON p.id = h.player_id
     WHERE h.status <> 'REVERTIDO' AND h.tipo = 'CIERRE_SEMANAL' AND h.week_start = ANY($1::date[])
     ORDER BY h.week_start`,
    [semanas]
  );
  const detalleBancados = bancadosRes.rows.map((row) => {
    const weekStart = toFechaStr(row.week_start);
    return {
      week_start: weekStart,
      week_end: sumarDias(weekStart, 6),
      club_name: `${row.club_name} — banca (${row.player_name})`,
      ganancia: Number(row.ganancia_banca_mesas),
      tipo: "BANCADO" as const,
    };
  });

  const detalle = [...detalleCierres, ...detalleBancados].sort((a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0));

  const aplicacionesRes = await pool.query(
    `SELECT a.id, a.amount, e.descripcion, e.tipo
     FROM extraordinary_adjustment_applications a JOIN extraordinary_adjustments e ON e.id = a.adjustment_id
     WHERE a.period_id = $1 ORDER BY a.applied_at`,
    [id]
  );
  const sueldoManos = await getSueldoDePeriodo(id);
  return { ...periodo, semanas, detalle, ajustesAplicados: aplicacionesRes.rows, sueldoManos };
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
  // Fuera de la transacción: crear la tabla con su FK a profit_periods choca con el lock de la
  // fila del período que se toma adentro.
  await asegurarTablaSueldosManos();
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

    const { gananciaOperativa, gananciaCierres, gananciaBancados } = await computeGananciaOperativa(client, weekStarts);
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
        ganancia_operativa = $1, ganancia_cierres = $2, ganancia_bancados = $3, retiros = $4, gastos = $5,
        ingresos_ajustes = $6, ganancia_antes_ajustes_dp = $7, ajustes_extraordinarios_dp = $8, ganancia_neta_final = $9
       WHERE id = $10`,
      [gananciaOperativa, gananciaCierres, gananciaBancados, retiros, gastos, ingresosAjustes, gananciaAntesAjustesDp, ajustesExtraordinariosDp, gananciaNetaFinal, id]
    );

    // Sueldo de Manos: se reconoce acá, una sola vez, sobre la ganancia neta final (ver repo/sueldoManos.ts).
    await generarSueldoEnCierre(client, { id, name: periodo.name }, gananciaNetaFinal);

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
 * que la memoria de bancados/rodeo en repo/closings.ts). El sueldo de Manos del período no se
 * toca: queda como está y se recalcula (o pasa a revisión si ya estaba pagado) al volver a
 * cerrarlo -- ver generarSueldoEnCierre. */
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
  // Un sueldo de Manos ya pagado no se borra nunca en silencio (el pago bajó la deuda de Juan).
  const sueldo = await getSueldoDePeriodo(id);
  if (sueldo && sueldo.movimiento_cuenta_juan_id) {
    throw new Error("Este período tiene el sueldo de Manos pagado: no se puede eliminar.");
  }
  if (periodoRes.rows[0].status === "CERRADO") {
    await reabrirPeriodo(id);
  }
  if (sueldo) await pool.query(`DELETE FROM manos_sueldos WHERE id = $1`, [sueldo.id]);
  await pool.query(`DELETE FROM profit_periods WHERE id = $1`, [id]);
}
