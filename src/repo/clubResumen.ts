// Resumen semanal por club — reproduce el bloque "RESUMEN DEL CLUB" de la planilla
// "automatizacion clubes" (RESUMEN_TB / RESUMEN_FENIX / RESUMEN_GG / RESUMEN_FENIX_GG /
// RESUMEN_XPOKER), confirmado formula por formula contra esa planilla el 14/09/2026. Ver el
// comentario en schema.sql (seccion "RESUMEN SEMANAL POR CLUB") para la explicacion completa
// de por que las 5 formulas se unifican en una sola. Tiny GG queda afuera por ahora.
//
// "Rodeo pagado agentes" y "Ganancia Rodeo Club" NO se cargan a mano: el motor de cierre
// (engine/rodeo.ts) ya calcula y guarda esto en weekly_closings.rodeo / .rodeo_club_share al
// aplicar cada cierre (solo aplica a SupremaPoker: Fenix/TeamBack Suprema). Solo "Ingreso por
// ventas" es un dato externo real que no sale de ningun cierre — ese si se carga a mano.
//
// "Jugadores"/"Ring Game"/"MTT"/"SNG" (columnas propias del formato Suprema) tambien vienen
// de weekly_closings — se guardan ahi desde la importacion (ver engine/importSuprema.ts,
// repo/imports.ts). NULL en cierres cargados antes de este cambio o de otras plataformas.
import { pool, newId } from "../db/pool.js";

// A que "familia" de formula pertenece un club, para que el frontend elija que columnas
// mostrar en la tabla por agente (cada familia tiene columnas distintas en la planilla real).
export type ClubFamily = "SUPREMA" | "GG" | "FENIX_GG" | "XPOKER" | "OTRO";

function familiaDeClub(nombre: string): ClubFamily {
  if (nombre === "TeamBack Suprema" || nombre === "Fénix Suprema") return "SUPREMA";
  if (nombre === "TeamBack GG") return "GG";
  if (nombre === "Fénix GG") return "FENIX_GG";
  if (nombre === "X-Poker") return "XPOKER";
  return "OTRO";
}

export interface FilaAgenteResumenClub {
  agentId: string;
  agentName: string;
  jugadores: number | null;
  resultado: number;
  rakeTotal: number;
  ringGame: number | null;
  mtt: number | null;
  sng: number | null;
  rakebackPct: number;
  rakebackAgente: number;
  comisionPlataforma: number;
  rebate: number;
  rodeoAgente: number;
  rodeoClubShare: number;
  gananciaPorRake: number;
  cierreFinalAgente: number;
  // "Ajuste manual" (18/09/2026, tickets promocionales): ya viene incluido en cierreFinalAgente
  // (lo suma/resta el motor, ver engine/cierre.ts) -- se expone aparte solo para mostrarlo como
  // renglón informativo en el resumen del club, igual que rodeoAgente.
  ajusteManual: number;
}

export interface ResumenClubSemanal {
  clubId: string;
  clubName: string;
  clubFamily: ClubFamily;
  weekStart: string;
  weekEnd: string | null;
  filas: FilaAgenteResumenClub[];
  rakeTotal: number;
  comisionesAgentes: number;
  comisionPlataformaTotal: number;
  rebateTotal: number;
  rodeoPagadoAgentes: number;
  gananciaRodeoClub: number;
  gananciaPorRake: number;
  ingresoPorVentas: number;
  tasaSemanalFija: number;
  gananciaNeta: number;
  cierreTotalAgentes: number;
  agentesConCierre: number;
  // Totales agregados para el resumen final (18/09/2026, pedido de Leo: que el resumen del
  // club muestre los mismos datos que venía anotando a mano en su planilla).
  jugadoresTotal: number | null;
  resultadoTotal: number;
  ajusteManualTotal: number;
}

export async function getResumenClubSemanal(clubId: string, weekStart: string): Promise<ResumenClubSemanal | null> {
  const clubRes = await pool.query(`SELECT id, name, platform_pct, weekly_fixed_fee FROM clubs WHERE id = $1`, [clubId]);
  if (clubRes.rows.length === 0) return null;
  const club = clubRes.rows[0];
  const ratioDefaultClub = 1 - Number(club.platform_pct);
  const clubFamily = familiaDeClub(club.name);

  const cierresRes = await pool.query(
    `SELECT wc.agent_id, a.name as agent_name, wc.week_end, wc.result, wc.rake_total, wc.rakeback_pct,
            wc.rakeback, wc.rebate, wc.final_closing, wc.rodeo, wc.rodeo_club_share,
            wc.jugadores, wc.ring_game, wc.mtt, wc.sng, wc.ajuste_manual,
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
  let comisionPlataformaTotal = 0;
  let rebateTotal = 0;
  let rodeoPagadoAgentes = 0;
  let gananciaRodeoClub = 0;
  let gananciaPorRake = 0;
  let cierreTotalAgentes = 0;
  let jugadoresTotal: number | null = null;
  let resultadoTotal = 0;
  let ajusteManualTotal = 0;
  let weekEnd: string | null = null;
  for (const r of cierresRes.rows) {
    const rake = Number(r.rake_total);
    const rakeback = Number(r.rakeback);
    const ratio = r.ratio_override !== null ? Number(r.ratio_override) : ratioDefaultClub;
    const gananciaFila = rake * ratio - rakeback;
    const comisionPlataformaFila = rake * (1 - ratio);
    filas.push({
      agentId: r.agent_id,
      agentName: r.agent_name,
      jugadores: r.jugadores !== null ? Number(r.jugadores) : null,
      resultado: Number(r.result),
      rakeTotal: rake,
      ringGame: r.ring_game !== null ? Number(r.ring_game) : null,
      mtt: r.mtt !== null ? Number(r.mtt) : null,
      sng: r.sng !== null ? Number(r.sng) : null,
      rakebackPct: Number(r.rakeback_pct),
      rakebackAgente: rakeback,
      comisionPlataforma: comisionPlataformaFila,
      rebate: Number(r.rebate),
      rodeoAgente: Number(r.rodeo),
      rodeoClubShare: Number(r.rodeo_club_share),
      gananciaPorRake: gananciaFila,
      cierreFinalAgente: Number(r.final_closing),
      ajusteManual: Number(r.ajuste_manual ?? 0),
    });
    rakeTotal += rake;
    comisionesAgentes += rakeback;
    comisionPlataformaTotal += comisionPlataformaFila;
    rebateTotal += Number(r.rebate);
    rodeoPagadoAgentes += Number(r.rodeo);
    gananciaRodeoClub += Number(r.rodeo_club_share);
    gananciaPorRake += gananciaFila;
    cierreTotalAgentes += Number(r.final_closing);
    if (r.jugadores !== null) jugadoresTotal = (jugadoresTotal ?? 0) + Number(r.jugadores);
    resultadoTotal += Number(r.result);
    ajusteManualTotal += Number(r.ajuste_manual ?? 0);
    if (!weekEnd) weekEnd = r.week_end;
  }

  const extrasRes = await pool.query(
    `SELECT ingreso_por_ventas FROM club_weekly_extras WHERE club_id = $1 AND week_start = $2`,
    [clubId, weekStart]
  );
  const ingresoPorVentas = Number(extrasRes.rows[0]?.ingreso_por_ventas ?? 0);
  const tasaSemanalFija = Number(club.weekly_fixed_fee);

  return {
    clubId: club.id,
    clubName: club.name,
    clubFamily,
    weekStart,
    weekEnd,
    filas,
    rakeTotal,
    comisionesAgentes,
    comisionPlataformaTotal,
    rebateTotal,
    rodeoPagadoAgentes,
    gananciaRodeoClub,
    gananciaPorRake,
    ingresoPorVentas,
    tasaSemanalFija,
    gananciaNeta: gananciaPorRake + gananciaRodeoClub + ingresoPorVentas + tasaSemanalFija,
    cierreTotalAgentes,
    agentesConCierre: filas.length,
    jugadoresTotal,
    resultadoTotal,
    ajusteManualTotal,
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

// Solo "Ingreso por ventas" se carga a mano (ver nota arriba) — el resto de esta tabla queda
// para el dia que haya que registrar mas datos externos de club/semana.
export interface ClubWeeklyExtrasInput {
  clubId: string;
  weekStart: string;
  weekEnd: string;
  ingresoPorVentas: number;
  observaciones?: string | null;
  createdBy?: string | null;
}

export async function upsertClubWeeklyExtras(input: ClubWeeklyExtrasInput) {
  const id = newId("cwe");
  const r = await pool.query(
    `INSERT INTO club_weekly_extras (id, club_id, week_start, week_end, ingreso_por_ventas, observaciones, created_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (club_id, week_start) DO UPDATE SET
       week_end = EXCLUDED.week_end,
       ingreso_por_ventas = EXCLUDED.ingreso_por_ventas,
       observaciones = EXCLUDED.observaciones,
       created_by = EXCLUDED.created_by,
       updated_at = now()
     RETURNING *`,
    [id, input.clubId, input.weekStart, input.weekEnd, input.ingresoPorVentas, input.observaciones ?? null, input.createdBy ?? null]
  );
  return r.rows[0];
}
