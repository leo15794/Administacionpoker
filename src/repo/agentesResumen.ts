// "Resumen por agente" (23/09/2026, pedido de Leo): réplica exacta de una planilla que ya usa
// a mano ("Estado de cuenta semanal" -- ver PDF de referencia "Cierre El Latigo Loco"), armada
// con lo que YA existe en el sistema: el agregado por club (weekly_closings), el detalle por
// jugador (weekly_closing_player_details, ver repo/closings.ts) y los "subagentes" (jugadores
// con % de rakeback propio, ver players.subagente_name/subagente_rakeback_pct). Puramente de
// LECTURA -- no escribe nada en ningún lado (pedido explícito de Leo: "no tiene que afectar
// nada").
import { pool } from "../db/pool.js";

// Misma lógica de deltaParaBalance (repo/ledger.ts), reescrita en SQL para poder sumar rangos
// de fecha sin traer todo el historial a JS. TRANSFERENCIA_ENTRE_CLUBES da 0 acá a propósito:
// sumado a TODOS los clubes del mismo agente (como hace este reporte, que agrega el agente
// entero) el origen y el destino se cancelan solos, así que no hace falta resolver el lado
// "destino" por separado.
const DELTA_SQL = `
  CASE type
    WHEN 'CARGA' THEN ABS(amount)
    WHEN 'DESCARGA' THEN -ABS(amount)
    WHEN 'COBRO' THEN -ABS(amount)
    WHEN 'PAGO' THEN -ABS(amount)
    WHEN 'TICKET_PROMOCIONAL' THEN amount
    WHEN 'AJUSTE' THEN amount
    WHEN 'CIERRE_SEMANAL' THEN amount
    WHEN 'PAGO_RAKEBACK' THEN 0
    WHEN 'ADELANTO_RAKEBACK' THEN 0
    WHEN 'TRANSFERENCIA_ENTRE_CLUBES' THEN 0
    ELSE amount
  END
`;

export interface ResumenAgentePDF {
  agentId: string;
  agentName: string;
  weekStart: string;
  weekEnd: string;
  clubes: {
    clubId: string;
    clubName: string;
    jugadores: number | null;
    resultado: number;
    rakeTotal: number;
    rebatePct: number;
    rebate: number;
    rakebackPct: number;
    rakebackBruto: number;
    rakebackNeto: number;
    rodeo: number;
    totalClub: number;
    ventas: number; // siempre 0 -- no hay ningún dato de "ventas" en el sistema (ver nota abajo)
    closingId: string;
  }[];
  // Detalle por jugador (page 3 del PDF de referencia) -- solo tiene datos para cierres
  // aplicados DESPUÉS de sumar weekly_closing_player_details (23/09/2026). Vacío para cierres
  // viejos o cargados a mano sin desglose -- no es un error, es la limitación ya avisada.
  detallePorClub: {
    clubId: string;
    clubName: string;
    rebatePctAgente: number;
    jugadores: {
      playerId: string | null;
      playerExternalId: string;
      playerName: string;
      resultado: number;
      rake: number;
      rebate: number;
      resultadoAjustado: number;
      rakebackPct: number;
      rakeback: number;
      cierre: number;
      subagenteName: string | null;
    }[];
    partidas: number | null;
    manos: number | null;
  }[];
  // Subagentes (page 4/5/6): un jugador con subagente_name configurado AL MOMENTO del cierre.
  subagentes: {
    subagenteName: string;
    clubId: string;
    clubName: string;
    resultado: number;
    rake: number;
    rebate: number;
    rakebackPctPrincipal: number;
    rakebackPrincipal: number; // neto (bruto + rebate), al % del agente
    rakebackPctSubagente: number;
    rakebackSubagente: number; // neto (bruto + rebate), al % propio del subagente
    margenPrincipal: number;
    rodeo: number;
    ventas: number;
    cierreSubagente: number;
    impactoPrincipal: number;
    jugadores: string[]; // nombres de los jugadores que forman este subagente, informativo
  }[];
  estadoCuenta: {
    saldoAnterior: number;
    cierreSemanal: number;
    pagosPosteriores: number;
    saldoOperativoFinal: number;
    nosDebe: number;
    debemos: number;
    situacion: "AGENTE ENVÍA" | "NOSOTROS ENVIAMOS" | "AL DÍA";
  };
}

export async function getResumenAgentePDF(agentId: string, weekStart: string): Promise<ResumenAgentePDF | null> {
  const agentRes = await pool.query(`SELECT id, name FROM agents WHERE id = $1`, [agentId]);
  if (!agentRes.rows[0]) return null;
  const agentName: string = agentRes.rows[0].name;

  const closingsRes = await pool.query(
    `SELECT wc.*, c.name as club_name
     FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE wc.agent_id = $1 AND wc.week_start = $2 AND wc.status <> 'REVERTIDO'
     ORDER BY c.name`,
    [agentId, weekStart]
  );
  if (closingsRes.rows.length === 0) return null;
  const weekEnd: string = String(closingsRes.rows[0].week_end).slice(0, 10);

  const clubes = closingsRes.rows.map((wc: any) => ({
    clubId: wc.club_id,
    clubName: wc.club_name,
    jugadores: wc.jugadores,
    resultado: Number(wc.result),
    rakeTotal: Number(wc.rake_total),
    rebatePct: Number(wc.rebate_pct),
    rebate: Number(wc.rebate),
    rakebackPct: Number(wc.rakeback_pct),
    rakebackBruto: Number(wc.rakeback),
    rakebackNeto: Number(wc.rakeback) + Number(wc.rebate),
    rodeo: Number(wc.rodeo),
    totalClub: Number(wc.final_closing),
    ventas: 0,
    closingId: wc.id,
  }));
  const closingIds: string[] = closingsRes.rows.map((wc: any) => wc.id);

  const detalleRes = await pool.query(
    `SELECT * FROM weekly_closing_player_details WHERE closing_id = ANY($1::text[]) ORDER BY player_name`,
    [closingIds]
  );

  // Subagente EN VIVO (23/09/2026, corrección pedida por Leo): el nombre/% de subagente NO se
  // usa "congelado" del momento del cierre -- siempre se lee lo que está cargado HOY en
  // players.subagente_name/subagente_rakeback_pct, así que si Leo edita el % después de aplicar
  // el cierre, el PDF sale con el % nuevo. Las columnas subagente_* de weekly_closing_player_details
  // quedan igual en la base (por las dudas / auditoría) pero este reporte ya no las lee.
  const playerIds = [...new Set(detalleRes.rows.map((d: any) => d.player_id).filter(Boolean))];
  const liveSubagenteMap = new Map<string, { name: string | null; pct: number | null }>();
  if (playerIds.length > 0) {
    const liveRes = await pool.query(
      `SELECT id, subagente_name, subagente_rakeback_pct FROM players WHERE id = ANY($1::text[])`,
      [playerIds]
    );
    for (const p of liveRes.rows) {
      liveSubagenteMap.set(p.id, {
        name: p.subagente_name ?? null,
        pct: p.subagente_rakeback_pct != null ? Number(p.subagente_rakeback_pct) : null,
      });
    }
  }
  for (const d of detalleRes.rows) {
    const live = d.player_id ? liveSubagenteMap.get(d.player_id) : undefined;
    const subagenteName: string | null = live?.name ?? null;
    const subagentePct: number | null = live && live.name ? live.pct : null;
    d.subagente_name = subagenteName;
    d.subagente_rakeback_pct = subagentePct;
    if (subagenteName && subagentePct !== null) {
      const rbSubBruto = Number(d.rake) * subagentePct;
      d.subagente_rakeback = rbSubBruto + Number(d.rebate);
      d.subagente_cierre = Number(d.resultado) + Number(d.subagente_rakeback);
    } else {
      d.subagente_rakeback = null;
      d.subagente_cierre = null;
    }
  }

  const detallePorClosing = new Map<string, any[]>();
  for (const d of detalleRes.rows) {
    const arr = detallePorClosing.get(d.closing_id) ?? [];
    arr.push(d);
    detallePorClosing.set(d.closing_id, arr);
  }

  const detallePorClub = closingsRes.rows.map((wc: any) => {
    const filas = detallePorClosing.get(wc.id) ?? [];
    return {
      clubId: wc.club_id,
      clubName: wc.club_name,
      rebatePctAgente: Number(wc.rebate_pct),
      jugadores: filas.map((d: any) => ({
        playerId: d.player_id,
        playerExternalId: d.player_external_id,
        playerName: d.player_name,
        resultado: Number(d.resultado),
        rake: Number(d.rake),
        rebate: Number(d.rebate),
        resultadoAjustado: Number(d.resultado_ajustado),
        rakebackPct: Number(d.rakeback_pct),
        rakeback: Number(d.rakeback),
        cierre: Number(d.cierre_jugador),
        subagenteName: d.subagente_name,
      })),
      partidas: null,
      manos: null,
    };
  });

  // Subagentes: agrupa por (subagente_name, club) sumando todos sus jugadores miembro.
  const subagentesMap = new Map<string, any>();
  for (const wc of closingsRes.rows) {
    const filas = (detallePorClosing.get(wc.id) ?? []).filter((d: any) => d.subagente_name);
    for (const d of filas) {
      const key = `${d.subagente_name}__${wc.club_id}`;
      const rebate = Number(d.rebate);
      const rakebackPrincipal = Number(d.rakeback) + rebate; // neto, % del agente
      const rakebackSubagente = Number(d.subagente_rakeback ?? 0); // ya neto (ver closings.ts)
      const cierreSubagente = Number(d.subagente_cierre ?? 0);
      const impactoPrincipal = Number(d.cierre_jugador);
      const acc = subagentesMap.get(key);
      if (acc) {
        acc.resultado += Number(d.resultado);
        acc.rake += Number(d.rake);
        acc.rebate += rebate;
        acc.rakebackPrincipal += rakebackPrincipal;
        acc.rakebackSubagente += rakebackSubagente;
        acc.cierreSubagente += cierreSubagente;
        acc.impactoPrincipal += impactoPrincipal;
        acc.jugadores.push(d.player_name);
      } else {
        subagentesMap.set(key, {
          subagenteName: d.subagente_name,
          clubId: wc.club_id,
          clubName: wc.club_name,
          resultado: Number(d.resultado),
          rake: Number(d.rake),
          rebate,
          rakebackPctPrincipal: Number(d.rakeback_pct),
          rakebackPrincipal,
          rakebackPctSubagente: Number(d.subagente_rakeback_pct ?? 0),
          rakebackSubagente,
          cierreSubagente,
          impactoPrincipal,
          jugadores: [d.player_name],
        });
      }
    }
  }
  const subagentes = Array.from(subagentesMap.values()).map((s) => ({
    ...s,
    margenPrincipal: s.rakebackPrincipal - s.rakebackSubagente,
    rodeo: 0,
    ventas: 0,
  }));

  // Estado de cuenta -- ver repo/agentesResumen.ts (comentario de cabecera) y la conversación
  // con Leo (23/09/2026): "total económico" (balance de fichas + rakeback/rebate/rodeo/ajuste
  // pendiente de pago), reconstruido desde el historial -- NUNCA escribe nada. Limitación
  // conocida y avisada: un pago financiero (PAGO_RAKEBACK) de un rakeback pendiente generado
  // en una semana anterior, pagado DESPUÉS de la semana de este reporte, no se resta de
  // "Pagos posteriores" (ese pago no mueve el balance de fichas, que es lo único que este
  // cálculo reconstruye del ledger) -- para verlo hay que mirar Rakeback pendiente aparte.
  const deltaRes = await pool.query(
    `SELECT
       COALESCE(SUM(${DELTA_SQL}) FILTER (WHERE occurred_at::date < $2::date), 0) as antes,
       COALESCE(SUM(${DELTA_SQL}) FILTER (WHERE occurred_at::date > $3::date), 0) as despues
     FROM ledger_movements
     WHERE agent_id = $1 AND status <> 'REVERTIDO'`,
    [agentId, weekStart, weekEnd]
  );
  const saldoFichasAntes = Number(deltaRes.rows[0]?.antes ?? 0);
  const pagosPosteriores = Number(deltaRes.rows[0]?.despues ?? 0);

  const pendienteAntesRes = await pool.query(
    `SELECT COALESCE(SUM(rp.amount - rp.consumed), 0) as total
     FROM rakeback_pendiente rp
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     WHERE rp.agent_id = $1 AND rp.active = true AND wc.week_end < $2::date AND wc.status <> 'REVERTIDO'`,
    [agentId, weekStart]
  );
  const rakebackPendienteAntes = Number(pendienteAntesRes.rows[0]?.total ?? 0);

  const saldoAnterior = saldoFichasAntes + rakebackPendienteAntes;
  const cierreSemanal = clubes.reduce((s, c) => s + c.totalClub, 0);
  const saldoOperativoFinal = saldoAnterior + cierreSemanal + pagosPosteriores;

  return {
    agentId,
    agentName,
    weekStart,
    weekEnd,
    clubes,
    detallePorClub,
    subagentes,
    estadoCuenta: {
      saldoAnterior,
      cierreSemanal,
      pagosPosteriores,
      saldoOperativoFinal,
      nosDebe: saldoOperativoFinal < 0 ? -saldoOperativoFinal : 0,
      debemos: saldoOperativoFinal > 0 ? saldoOperativoFinal : 0,
      situacion: saldoOperativoFinal < 0 ? "AGENTE ENVÍA" : saldoOperativoFinal > 0 ? "NOSOTROS ENVIAMOS" : "AL DÍA",
    },
  };
}

// Semanas con al menos un cierre aplicado (para el selector del PDF) -- distinct week_start
// entre todos los agentes, más reciente primero.
export async function listSemanasConResumenAgente(): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT week_start FROM weekly_closings WHERE status <> 'REVERTIDO' ORDER BY week_start DESC LIMIT 52`
  );
  return r.rows.map((row: any) => String(row.week_start).slice(0, 10));
}
