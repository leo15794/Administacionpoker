// Resumen semanal de club para Tiny GG (18/09/2026, pedido de Leo) -- a diferencia del resto de
// los clubes (ver clubResumen.ts), la ganancia de Tiny no sale de un % fijo sobre el rake: sale
// de la diferencia entre lo que la Union/GG nos liquida a nosotros (Settlement) y lo que
// nosotros les pagamos a los agentes (Cierre agentes). Formulas confirmadas por Leo contra su
// planilla "TINY - CIERRE SEMANAL" (auditoria 18/09/2026), cierran al centavo:
//
//   Settlement Tiny (moneda propia de Tiny) = Resultado Tiny + Rebate global + Rake share
//   Settlement USDT = Settlement Tiny / Rate semanal
//   Ganancia nuestra USDT = Settlement USDT - Cierre agentes USDT
//   Diferencia cierre Tiny = Settlement Tiny - Weekly Settlement oficial (lo que Tiny reporta
//     en su propio archivo, hoja 1, fila "當週交收金額" -- ver engine/importTinyGG.ts) -- sirve
//     para detectar si Tiny liquido mal, no es un numero que nosotros calculemos.
//
// "Resultado Tiny"/"Rake Tiny" (moneda propia) se reconstruyen desde weekly_closings
// multiplicando el resultado/rake ya guardado en USD por el rate_snapshot de ESE cierre (la
// tasa ficha->USD que se cargo al importar) -- no hace falta guardarlos aparte en moneda propia.
import { pool, newId } from "../db/pool.js";
import type { TinyRebateUnionPorArchivo } from "./imports.js";

/** Persiste el Rebate Union / Rake share por archivo (super agente) de Tiny para un club+semana
 * -- hoy este dato se calcula al importar y se muestra en el panel de conciliacion de Cierres,
 * pero se pierde apenas se cierra esa pantalla. Se llama UNA VEZ por club, justo despues de
 * aplicar (nunca en la vista previa) todos los cierres de esa corrida de Tiny -- ver
 * Cierres.tsx::aplicarTodo. Upsert por (club_id, week_start, file_name): reintentar la misma
 * semana nunca duplica filas, solo pisa con los valores mas nuevos. */
export async function guardarTinyRebateUnion(
  clubId: string,
  weekStart: string,
  weekEnd: string,
  items: TinyRebateUnionPorArchivo[]
) {
  for (const it of items) {
    await pool.query(
      `INSERT INTO tiny_rebate_union
        (id, club_id, week_start, week_end, file_name, super_agent_nickname,
         rg_pre_rake_excl_jp, rebate_union_calculado, rebate_union_tiny,
         rake_total_ring_game, rate_pct, rake_share, weekly_settlement_oficial, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (club_id, week_start, file_name) DO UPDATE SET
         week_end = EXCLUDED.week_end,
         super_agent_nickname = EXCLUDED.super_agent_nickname,
         rg_pre_rake_excl_jp = EXCLUDED.rg_pre_rake_excl_jp,
         rebate_union_calculado = EXCLUDED.rebate_union_calculado,
         rebate_union_tiny = EXCLUDED.rebate_union_tiny,
         rake_total_ring_game = EXCLUDED.rake_total_ring_game,
         rate_pct = EXCLUDED.rate_pct,
         rake_share = EXCLUDED.rake_share,
         weekly_settlement_oficial = EXCLUDED.weekly_settlement_oficial,
         updated_at = now()`,
      [
        newId("tru"),
        clubId,
        weekStart,
        weekEnd,
        it.fileName,
        it.superAgentNickname,
        it.rgPreRakeExclJp,
        it.rebateUnionCalculado,
        it.rebateUnionTiny,
        it.rakeTotalRingGame,
        it.ratePct,
        it.rakeShare,
        it.weeklySettlementOficial,
      ]
    );
  }
}

export interface ResumenTinyExtra {
  clubId: string;
  weekStart: string;
  weekEnd: string | null;
  agentesConCierre: number;
  jugadoresTotal: number | null;
  // Moneda propia de Tiny (reconstruida via rate_snapshot -- ver nota arriba).
  resultadoTiny: number;
  rakeTiny: number;
  bbjContribution: number;
  // Rebate Union / Rake share (guardados al aplicar, ver guardarTinyRebateUnion) -- sumados si
  // hubo mas de un super agente para este club+semana.
  baseRebateGlobal: number | null;
  rebateGlobal: number;
  rakeShareTotal: number;
  // Un solo rate semanal para toda la corrida (Leo carga uno solo por importacion) -- si por
  // algun motivo hay cierres con distinto rate_snapshot esa semana, se usa el mas comun.
  rateSemanal: number | null;
  settlementTiny: number;
  settlementUsdt: number;
  cierreAgentesUsdt: number;
  gananciaNuestraUsdt: number;
  // Comparacion contra lo que Tiny reporta en su propio archivo (hoja 1, "當週交收金額") --
  // null si no se pudo leer ese dato de ningun archivo de esta semana (archivo viejo, formato
  // distinto, etc.) -- en ese caso no hay con que comparar, no se inventa un OK falso.
  weeklySettlementOficialTotal: number | null;
  diferenciaCierreTiny: number | null;
  estadoControl: "OK" | "REVISAR" | "SIN_DATO";
}

const EPS_CONTROL = 0.5; // tolerancia en moneda propia de Tiny (redondeos de conversion)

export async function getResumenTinyExtra(clubId: string, weekStart: string): Promise<ResumenTinyExtra | null> {
  const cierresRes = await pool.query(
    `SELECT wc.result, wc.rake_total, wc.final_closing, wc.rate_snapshot, wc.jugadores,
            wc.bbj_contribution, wc.week_end
     FROM weekly_closings wc
     WHERE wc.club_id = $1 AND wc.week_start = $2 AND wc.status <> 'REVERTIDO'`,
    [clubId, weekStart]
  );
  if (cierresRes.rows.length === 0) return null;

  let resultadoTiny = 0;
  let rakeTiny = 0;
  let bbjContribution = 0;
  let cierreAgentesUsdt = 0;
  let jugadoresTotal: number | null = null;
  let weekEnd: string | null = null;
  const rateCount = new Map<number, number>();
  for (const r of cierresRes.rows) {
    const rate = Number(r.rate_snapshot) || 1;
    resultadoTiny += Number(r.result) * rate;
    rakeTiny += Number(r.rake_total) * rate;
    bbjContribution += Number(r.bbj_contribution ?? 0);
    cierreAgentesUsdt += Number(r.final_closing);
    if (r.jugadores !== null) jugadoresTotal = (jugadoresTotal ?? 0) + Number(r.jugadores);
    rateCount.set(rate, (rateCount.get(rate) ?? 0) + 1);
    if (!weekEnd) weekEnd = r.week_end;
  }
  let rateSemanal: number | null = null;
  let mejorConteo = 0;
  for (const [rate, count] of rateCount) {
    if (count > mejorConteo) {
      mejorConteo = count;
      rateSemanal = rate;
    }
  }

  const rebateRes = await pool.query(
    `SELECT
       COALESCE(SUM(rg_pre_rake_excl_jp), NULL) as base_rebate_global,
       COALESCE(SUM(rebate_union_calculado), 0) as rebate_global,
       COALESCE(SUM(rake_share), 0) as rake_share_total,
       CASE WHEN COUNT(weekly_settlement_oficial) = 0 THEN NULL ELSE SUM(weekly_settlement_oficial) END as weekly_settlement_oficial_total
     FROM tiny_rebate_union
     WHERE club_id = $1 AND week_start = $2`,
    [clubId, weekStart]
  );
  const rr = rebateRes.rows[0] ?? {};
  const baseRebateGlobal = rr.base_rebate_global !== null && rr.base_rebate_global !== undefined ? Number(rr.base_rebate_global) : null;
  const rebateGlobal = Number(rr.rebate_global ?? 0);
  const rakeShareTotal = Number(rr.rake_share_total ?? 0);
  const weeklySettlementOficialTotal =
    rr.weekly_settlement_oficial_total !== null && rr.weekly_settlement_oficial_total !== undefined
      ? Number(rr.weekly_settlement_oficial_total)
      : null;

  const settlementTiny = resultadoTiny + rebateGlobal + rakeShareTotal;
  const settlementUsdt = rateSemanal ? settlementTiny / rateSemanal : 0;
  const gananciaNuestraUsdt = settlementUsdt - cierreAgentesUsdt;

  const diferenciaCierreTiny = weeklySettlementOficialTotal != null ? settlementTiny - weeklySettlementOficialTotal : null;
  const estadoControl: "OK" | "REVISAR" | "SIN_DATO" =
    diferenciaCierreTiny == null ? "SIN_DATO" : Math.abs(diferenciaCierreTiny) <= EPS_CONTROL ? "OK" : "REVISAR";

  return {
    clubId,
    weekStart,
    weekEnd,
    agentesConCierre: cierresRes.rows.length,
    jugadoresTotal,
    resultadoTiny,
    rakeTiny,
    bbjContribution,
    baseRebateGlobal,
    rebateGlobal,
    rakeShareTotal,
    rateSemanal,
    settlementTiny,
    settlementUsdt,
    cierreAgentesUsdt,
    gananciaNuestraUsdt,
    weeklySettlementOficialTotal,
    diferenciaCierreTiny,
    estadoControl,
  };
}
