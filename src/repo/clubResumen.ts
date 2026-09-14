// Resumen semanal por club — reproduce el bloque "RESUMEN DEL CLUB" de la planilla
// "automatizacion clubes" (RESUMEN_TB / RESUMEN_FENIX / RESUMEN_GG / RESUMEN_FENIX_GG /
// RESUMEN_XPOKER), confirmado formula por formula contra esa planilla el 14/09/2026. Ver el
// comentario en schema.sql (seccion "RESUMEN SEMANAL POR CLUB") para la explicacion completa
// de por que las 5 formulas se unifican en una sola. Tiny GG queda afuera por ahora.
//
// Muestra dos niveles, igual que la planilla: el desglose fila por fila de cada agente que
// cerro esa semana en ese club, y despues el resumen total del club (que es la suma de esas
// filas mas los dos datos externos — Ganancia Rodeo Club e Ingreso por ventas — y el fee fijo
// semanal del club si tiene, ej. Tasa semanal GG).
import { pool, newId } from "../db/pool.js";

export interface FilaAgenteResumenClub {
  agentId: string;
  agentName: string;
  resultado: number;
  rakeTotal: number;
  rakebackPct: number;
  rakebackAgente: number;
  rebate: number;
  gananciaPorRake: number;
  cierreFinalAgente: number;
}

export interface ResumenClubSemanal {
  clubId: string;
  clubName: string;
  weekStart: string;
  weekEnd: string | null;
  filas: FilaAgenteResumenClub[];
  rakeTotal: number;
  comisionesAgentes: number;
  rebateTotal: number;
  gananciaPorRake: number;
  gananciaRodeoClub: number;
  ingresoPorVentas: number;
  tasaSemanalFija: number;
  gananciaNeta: number;
  cierreTotalAgentes: number;
  agentesConCierre: number;
}

export async function getResumenClubSemanal(clubId: string, weekStart: string): Promise<ResumenClubSemanal | null> {
  const clubRes = await pool.query(`SELECT id, name, platform_pct, weekly_fixed_fee FROM clubs WHERE id = $1`, [clubId]);
  if (clubRes.rows.length === 0) return null;
  const club = clubRes.rows[0];
  const ratioDefaultClub = 1 - Number(club.platform_pct);

  const cierresRes = await pool.query(
    `SELECT wc.agent_id, a.name as agent_name, wc.week_end, wc.result, wc.rake_total, wc.rakeback_pct,
            wc.rakeback, wc.rebate, wc.final_closing,
            (SELECT d.club_payout_ratio_override FROM agent_club_deals d
             WHERE d.agent_id = wc.agent_id AND d.club_id = wc.club_id AND d.valid_to IS NULL
             ORDER BY d.valid_from DESC LIMIT 1) as ratio_override
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     WHERE wc.club_id = $1 AND wc.week_start = $2 AND wc.status <> 'REVERTIDO'
     ORDER BY a.name`,
    [clubId, weekStart]
  );

  const filas: FilaAgenteResumenClub[] = [];
  let rakeTotal = 0;
  let comisionesAgentes = 0;
  let rebateTotal = 0;
  let gananciaPorRake = 0;
  let cierreTotalAgentes = 0;
  let weekEnd: string | null = null;
  for (const r of cierresRes.rows) {
    const rake = Number(r.rake_total);
    const rakeback = Number(r.rakeback);
    const ratio = r.ratio_override !== null ? Number(r.ratio_override) : ratioDefaultClub;
    const gananciaFila = rake * ratio - rakeback;
    filas.push({
      agentId: r.agent_id,
      agentName: r.agent_name,
      resultado: Number(r.result),
      rakeTotal: rake,
      rakebackPct: Number(r.rakeback_pct),
      rakebackAgente: rakeback,
      rebate: Number(r.rebate),
      gananciaPorRake: gananciaFila,
      cierreFinalAgente: Number(r.final_closing),
    });
    rakeTotal += rake;
    comisionesAgentes += rakeback;
    rebateTotal += Number(r.rebate);
    gananciaPorRake += gananciaFila;
    cierreTotalAgentes += Number(r.final_closing);
    if (!weekEnd) weekEnd = r.week_end;
  }

  const extrasRes = await pool.query(
    `SELECT ganancia_rodeo_club, ingreso_por_ventas FROM club_weekly_extras WHERE club_id = $1 AND week_start = $2`,
    [clubId, weekStart]
  );
  const gananciaRodeoClub = Number(extrasRes.rows[0]?.ganancia_rodeo_club ?? 0);
  const ingresoPorVentas = Number(extrasRes.rows[0]?.ingreso_por_ventas ?? 0);
  const tasaSemanalFija = Number(club.weekly_fixed_fee);

  return {
    clubId: club.id,
    clubName: club.name,
    weekStart,
    weekEnd,
    filas,
    rakeTotal,
    comisionesAgentes,
    rebateTotal,
    gananciaPorRake,
    gananciaRodeoClub,
    ingresoPorVentas,
    tasaSemanalFija,
    gananciaNeta: gananciaPorRake + gananciaRodeoClub + ingresoPorVentas + tasaSemanalFija,
    cierreTotalAgentes,
    agentesConCierre: filas.length,
  };
}

export async function listSemanasConCierres(clubId?: string) {
  const r = await pool.query(
    clubId
      ? `SELECT DISTINCT week_start, week_end FROM weekly_closings WHERE club_id = $1 AND status <> 'REVERTIDO' ORDER BY week_start DESC`
      : `SELECT DISTINCT week_start, week_end FROM weekly_closings WHERE status <> 'REVERTIDO' ORDER BY week_start DESC`,
    clubId ? [clubId] : []
  );
  return r.rows;
}

export interface ClubWeeklyExtrasInput {
  clubId: string;
  weekStart: string;
  weekEnd: string;
  gananciaRodeoClub: number;
  ingresoPorVentas: number;
  observaciones?: string | null;
  createdBy?: string | null;
}

export async function upsertClubWeeklyExtras(input: ClubWeeklyExtrasInput) {
  const id = newId("cwe");
  const r = await pool.query(
    `INSERT INTO club_weekly_extras (id, club_id, week_start, week_end, ganancia_rodeo_club, ingreso_por_ventas, observaciones, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (club_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end,
       ganancia_rodeo_club = EXCLUDED.ganancia_rodeo_club,
       ingreso_por_ventas = EXCLUDED.ingreso_por_ventas,
       observaciones = EXCLUDED.observaciones,
       created_by = EXCLUDED.created_by,
       updated_at = now()
     RETURNING *`,
    [
      id,
      input.clubId,
      input.weekStart,
      input.weekEnd,
      input.gananciaRodeoClub,
      input.ingresoPorVentas,
      input.observaciones ?? null,
      input.createdBy ?? null,
    ]
  );
  return r.rows[0];
}
