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
    WHEN 'ADELANTO_FICHAS' THEN -ABS(amount)
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
    // Ajuste manual cargado al momento del cierre (ej. "tarjeta vip", descuentos puntuales, etc)
    // -- pedido de Leo (24/09/2026): sin esto el "Total club" no cerraba contra
    // Resultado+Rebate+Rakeback y no se veía por qué (ver engine/cierre.ts calc.ajusteManual).
    ajusteManual: number;
    ajusteManualNota: string | null;
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
      rebatePct: number;
      rebate: number;
      resultadoAjustado: number;
      rakebackPct: number;
      rakeback: number; // bruto -- alias de rakebackBruto, se deja por compatibilidad
      rakebackBruto: number;
      rakebackNeto: number;
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
    // fichasAdelantadasPendientes (29/09/2026, pedido de Leo: "necesito poder ver las fichas
    // que se le cargaron y estan pendiente de cobrar, por agente") -- total ACTUAL (no de esta
    // semana en particular) de "Adelanto de fichas" activos sin cobrar del todo, ya incluido en
    // saldoAnterior/saldoOperativoFinal (ver ADELANTO_FICHAS en deltaParaBalance) -- se muestra
    // aparte solo para que quede explícito cuánto de ese saldo es por esto.
    fichasAdelantadasPendientes: number;
    // Desglose de "Saldo anterior" (30/09/2026, pedido de Leo: "necesito que me hagas un
    // desglose de como se compone el saldo anterior y despues que se haga la suma") -- antes
    // saldoAnterior era un solo número ya sumado, sin forma de ver de dónde salía. Ahora se
    // exponen los dos componentes que lo forman (saldoFichasAntes + pendientesAnteriores, ver
    // más abajo en la función) y el detalle ITEMIZADO de cada cierre anterior sin pagar del
    // todo, para que se pueda auditar el número a mano si algo no cierra.
    saldoFichasAntes: number;
    pendientesAnterioresTotal: number;
    pendientesAnterioresDetalle: {
      clubId: string;
      clubName: string;
      weekStart: string;
      weekEnd: string;
      amount: number; // total original del pendiente de ese cierre
      consumed: number; // ya pagado/cruzado de ese pendiente
      disponible: number; // amount - consumed, lo que efectivamente entra a la suma
    }[];
  };
}

export async function getResumenAgentePDF(
  agentId: string,
  weekStart: string,
  sistema: "WIN_LOSE" | "PREPAGO" = "WIN_LOSE"
): Promise<ResumenAgentePDF | null> {
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
    ajusteManual: Number(wc.ajuste_manual ?? 0),
    ajusteManualNota: wc.ajuste_manual_nota ?? null,
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
  //
  // Se hace match por (club_id, external_id) -- la MISMA clave que se usa en TODO el resto del
  // sistema para identificar un jugador (ver repo/imports.ts, repo/closings.ts) -- en vez de por
  // player_id de weekly_closing_player_details. Es más robusto: esa columna puede haber quedado
  // NULL en algún cierre viejo (el jugador no se llegó a resolver en ese momento), y si se
  // matcheara solo por ahí, ningún cambio de % futuro se vería nunca reflejado.
  const closingIdToClubId = new Map<string, string>(closingsRes.rows.map((wc: any) => [wc.id, wc.club_id]));
  const paresClubExterno = [
    ...new Map(
      detalleRes.rows.map((d: any) => {
        const clubId = closingIdToClubId.get(d.closing_id) ?? "";
        return [`${clubId}__${d.player_external_id}`, { clubId, externalId: d.player_external_id }];
      })
    ).values(),
  ];
  const liveSubagenteMap = new Map<string, { name: string | null; pct: number | null }>();
  if (paresClubExterno.length > 0) {
    const liveRes = await pool.query(
      `SELECT p.club_id, p.external_id, p.subagente_name, p.subagente_rakeback_pct
       FROM players p
       JOIN (SELECT unnest($1::text[]) AS club_id, unnest($2::text[]) AS external_id) k
         ON p.club_id = k.club_id AND p.external_id = k.external_id`,
      [paresClubExterno.map((p) => p.clubId), paresClubExterno.map((p) => p.externalId)]
    );
    for (const p of liveRes.rows) {
      liveSubagenteMap.set(`${p.club_id}__${p.external_id}`, {
        name: p.subagente_name ?? null,
        pct: p.subagente_rakeback_pct != null ? Number(p.subagente_rakeback_pct) : null,
      });
    }
  }
  for (const d of detalleRes.rows) {
    const clubId = closingIdToClubId.get(d.closing_id) ?? "";
    const live = liveSubagenteMap.get(`${clubId}__${d.player_external_id}`);
    const subagenteName: string | null = live?.name ?? null;
    // pctOverride vale con O SIN nombre (24/09/2026, pedido de Leo: "que no sea obligatorio lo
    // del subagente") -- el nombre solo decide si además arma una liquidación de subagente
    // aparte (sección "Subagentes" del PDF); el % en sí siempre reemplaza al % del agente en la
    // fila normal de ese jugador, tenga nombre o no.
    const pctOverride: number | null = live?.pct ?? null;
    d.subagente_name = subagenteName;
    d.subagente_rakeback_pct = pctOverride;
    if (pctOverride !== null) {
      const rakebackBrutoOverride = Number(d.rake) * pctOverride;
      const rakebackOverride = rakebackBrutoOverride + Number(d.rebate); // neto
      const cierreOverride = Number(d.resultado) + rakebackOverride;
      d.subagente_rakeback = rakebackOverride;
      d.subagente_cierre = cierreOverride;
      // Fila normal del jugador: con % propio configurado, ESE % reemplaza al % del agente acá
      // -- pedido explícito de Leo, "solo necesitamos el % de rakeback para los jugadores".
      d.rakeback_pct_efectivo = pctOverride;
      // 30/09/2026: se separan bruto y neto (antes solo había un campo "rakeback_efectivo" que
      // en esta rama guardaba el NETO pero en la rama de abajo guardaba el BRUTO -- inconsistencia
      // que no se notaba porque nada mostraba los dos juntos. El PDF de referencia que pasó Leo
      // ("Cierre El Latigo Loco") muestra "Rakeback bruto" y "Rakeback neto" como dos columnas
      // separadas por jugador, así que hace falta que las dos estén bien en los dos casos.
      d.rakeback_bruto_efectivo = rakebackBrutoOverride;
      d.rakeback_neto_efectivo = rakebackOverride;
      d.cierre_efectivo = cierreOverride;
    } else {
      d.subagente_rakeback = null;
      d.subagente_cierre = null;
      d.rakeback_pct_efectivo = Number(d.rakeback_pct);
      // d.rakeback (columna de weekly_closing_player_details) siempre guarda el BRUTO -- ver
      // repo/closings.ts: rakebackBruto = j.rake * calc.rakebackPct, cierreJugador =
      // resultadoAjustado + rakebackBruto (mismo criterio que a nivel club, ver wc.rakeback).
      d.rakeback_bruto_efectivo = Number(d.rakeback);
      d.rakeback_neto_efectivo = Number(d.rakeback) + Number(d.rebate);
      d.cierre_efectivo = Number(d.cierre_jugador);
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
        rebatePct: Number(d.rebate_pct),
        rebate: Number(d.rebate),
        resultadoAjustado: Number(d.resultado_ajustado),
        // Con % propio configurado (con o sin nombre de subagente) esto ya viene calculado a SU
        // % en vez del % del agente -- ver el loop de arriba (pctOverride).
        rakebackPct: Number(d.rakeback_pct_efectivo),
        rakeback: Number(d.rakeback_bruto_efectivo),
        rakebackBruto: Number(d.rakeback_bruto_efectivo),
        rakebackNeto: Number(d.rakeback_neto_efectivo),
        cierre: Number(d.cierre_efectivo),
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

  // Estado de cuenta (redefinido 30/09/2026, pedido de Leo sobre la versión anterior de este
  // mismo cálculo):
  //  - "Saldo anterior" = saldo de FICHAS puro (CARGA/DESCARGA únicamente) antes de la semana --
  //    antes sumaba TODOS los tipos de movimiento (incluía COBRO/PAGO/AJUSTE/etc, que son plata
  //    ya movida y no saldo de stock pendiente), lo que mezclaba dos cosas distintas.
  //  - "Pagos / movimientos" = movimientos de TODO tipo ocurridos DURANTE la semana del cierre
  //    (antes eran los posteriores a la semana, que en realidad es otra cosa).
  //  - "Saldo operativo final" sigue siendo la suma de saldo anterior + cierre semanal + estos
  //    movimientos de la semana -- misma fórmula, operandos redefinidos.
  // ADELANTO_FICHAS entra acá también (29/09/2026) -- es fichas físicas entregadas, mismo
  // "saldo de stock" que CARGA/DESCARGA, solo que en contra del agente (ver deltaParaBalance) --
  // sin esto, un adelanto de fichas de una semana anterior desaparecía de "saldo anterior" al
  // pasar la semana, aunque siguiera sin cobrarse.
  //
  // CIERRE_SEMANAL se excluye de "movimientos_semana" (30/09/2026, bug reportado por Leo: "por
  // que se suma dos veces") -- al aplicar un cierre se genera un movimiento de ledger tipo
  // CIERRE_SEMANAL fechado el weekEnd (ver repo/closings.ts), por el mismo monto que ya
  // representa "cierreSemanal" más abajo (calculado aparte, de clubes.totalClub/rakebackNeto).
  // Como cae DENTRO del rango [weekStart, weekEnd], sin este filtro quedaba sumado dos veces en
  // "Saldo operativo final" (cierreSemanal + ese mismo monto otra vez via pagosPosteriores).
  const deltaRes = await pool.query(
    `SELECT
       COALESCE(SUM(${DELTA_SQL}) FILTER (WHERE type IN ('CARGA','DESCARGA','ADELANTO_FICHAS') AND occurred_at::date < $2::date), 0) as saldo_fichas_antes,
       COALESCE(SUM(${DELTA_SQL}) FILTER (WHERE occurred_at::date BETWEEN $2::date AND $3::date AND type <> 'CIERRE_SEMANAL'), 0) as movimientos_semana
     FROM ledger_movements
     WHERE agent_id = $1 AND status <> 'REVERTIDO'`,
    [agentId, weekStart, weekEnd]
  );
  const saldoFichasAntes = Number(deltaRes.rows[0]?.saldo_fichas_antes ?? 0);
  const pagosPosteriores = Number(deltaRes.rows[0]?.movimientos_semana ?? 0);

  const fichasAdelantadasRes = await pool.query(
    `SELECT COALESCE(SUM(amount - consumed), 0) as total
     FROM rakeback_advances
     WHERE agent_id = $1 AND kind = 'FICHAS_PENDIENTE' AND active = true AND amount > consumed`,
    [agentId]
  );
  const fichasAdelantadasPendientes = Number(fichasAdelantadasRes.rows[0]?.total ?? 0);

  // Detalle ITEMIZADO (30/09/2026, pedido de Leo: "desglose de como se compone el saldo
  // anterior") -- antes esto solo traía el SUM ya sumado (rakebackPendienteAntes). Ahora trae
  // cada fila de rakeback_pendiente de un cierre anterior sin pagar del todo, para poder mostrar
  // "esto viene de tal cierre, tal club, tal semana, por tanto" en vez de un número opaco.
  const pendienteAntesRes = await pool.query(
    // rp.amount <> rp.consumed (no ">" -- amount puede ser negativo, un cierre WIN_LOSE en
    // pérdida) filtra los ya saldados del todo, para no ensuciar el desglose con cierres
    // viejos que ya no aportan nada (igual criterio que el fix de catalog.ts de hoy).
    `SELECT rp.amount, rp.consumed, wc.club_id, c.name as club_name, wc.week_start, wc.week_end
     FROM rakeback_pendiente rp
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     JOIN clubs c ON c.id = wc.club_id
     WHERE rp.agent_id = $1 AND rp.active = true AND wc.week_end < $2::date AND wc.status <> 'REVERTIDO'
       AND rp.amount <> rp.consumed
     ORDER BY wc.week_start, c.name`,
    [agentId, weekStart]
  );
  const pendientesAnterioresDetalle = pendienteAntesRes.rows.map((row: any) => ({
    clubId: row.club_id,
    clubName: row.club_name,
    weekStart: String(row.week_start).slice(0, 10),
    weekEnd: String(row.week_end).slice(0, 10),
    amount: Number(row.amount),
    consumed: Number(row.consumed),
    disponible: Number(row.amount) - Number(row.consumed),
  }));
  const rakebackPendienteAntes = pendientesAnterioresDetalle.reduce((s, r) => s + r.disponible, 0);

  const saldoAnterior = saldoFichasAntes + rakebackPendienteAntes;
  // Cierre semanal: en WIN_LOSE es el total club de siempre (resultado + rakeback neto + rodeo +
  // ajuste -- así lo pide el PDF de referencia "Cierre El Latigo Loco"). En PREPAGO el resultado
  // de juego no es responsabilidad del agente (el club ya lo maneja directo), así que el cierre
  // semanal del agente es solo el rakeback neto que se ganó esa semana -- pedido de Leo
  // (30/09/2026), tras ver que con un club Prepago el total club incluía de más el resultado.
  const cierreSemanal =
    sistema === "PREPAGO"
      ? clubes.reduce((s, c) => s + c.rakebackNeto, 0)
      : clubes.reduce((s, c) => s + c.totalClub, 0);
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
      fichasAdelantadasPendientes,
      saldoFichasAntes,
      pendientesAnterioresTotal: rakebackPendienteAntes,
      pendientesAnterioresDetalle,
    },
  };
}

// "Saldos actuales" (01/10/2026, pedido de Leo: "que aparezcan todos los agentes con el saldo
// que tienen a la fecha... quiero saber como se constituye el saldo del agente ahi en ese
// momento" -- ejemplo que dio: ficha de agente del buscador mostraba Saldo neto total y
// Adelantos pendientes como dos números separados, y en realidad el saldo REAL tiene que
// descontar el adelanto pendiente). A PROPÓSITO separado de getResumenAgentePDF (que es por
// semana elegida): esto es una FOTO DE HOY, de TODOS los agentes activos a la vez, pensada para
// la pestaña nueva "Saldos actuales" de Resumen por Agente -- no toca la función de armar
// resumen semanal, que sigue igual. Confirmado con Leo: esta resta (saldoReal = saldoNetoTotal
// - adelantosPendientes) es SOLO para esta pantalla -- no se tocó la definición de "saldo neto
// total" en ningún otro lado del sistema (Administración, Mi Cuenta, ficha del buscador, PDF de
// estado de cuenta siguen mostrando los dos números por separado, sin restar).
export interface SaldoActualAgente {
  agentId: string;
  agentName: string;
  defaultSystem: "PREPAGO" | "WIN_LOSE";
  supervisor: string | null;
  saldoPorClub: {
    clubId: string;
    clubName: string;
    system: "PREPAGO" | "WIN_LOSE";
    amount: number;
    totalFichasGanadasMesas: number;
    saldoNeto: number; // PREPAGO: amount + mesas. WIN_LOSE: amount tal cual.
  }[];
  saldoNetoTotal: number; // suma de saldoNeto de todos los clubes
  adelantos: {
    id: string;
    amount: number;
    consumed: number;
    disponible: number; // amount - consumed, lo que todavía no se descontó
    medio: "FICHAS" | "USDT" | null;
    clubOrigenName: string | null;
    notes: string | null;
    createdAt: string;
  }[];
  adelantosPendientes: number; // suma de disponible
  saldoReal: number; // saldoNetoTotal - adelantosPendientes
}

export async function listSaldosActualesAgentes(): Promise<SaldoActualAgente[]> {
  const agentesRes = await pool.query(
    `SELECT id, name, default_system, supervisor FROM agents WHERE active = true ORDER BY name`
  );

  const balancesRes = await pool.query(
    `SELECT b.agent_id, b.club_id, c.name as club_name, b.amount,
            COALESCE(
              (SELECT d.system FROM agent_club_deals d
               WHERE d.agent_id = b.agent_id AND d.club_id = b.club_id AND d.valid_to IS NULL
               ORDER BY d.valid_from DESC LIMIT 1),
              a.default_system
            ) as system,
            COALESCE(mesas.total_fichas_ganadas_mesas, 0) as total_fichas_ganadas_mesas
     FROM balances b
     JOIN agents a ON a.id = b.agent_id
     JOIN clubs c ON c.id = b.club_id
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(wc.result), 0) as total_fichas_ganadas_mesas
       FROM weekly_closings wc
       WHERE wc.agent_id = b.agent_id AND wc.club_id = b.club_id AND wc.status <> 'REVERTIDO'
         AND wc.system = 'PREPAGO'
     ) mesas ON true
     WHERE a.active = true
     ORDER BY c.name`
  );

  // amount <> consumed (no ">" -- mismo criterio que pendientesAnterioresDetalle más arriba en
  // este archivo): filtra los ya saldados del todo, para no ensuciar el desglose.
  const adelantosRes = await pool.query(
    `SELECT ra.id, ra.agent_id, ra.amount, ra.consumed, ra.medio, ra.notes, ra.created_at,
            c.name as club_origen_name
     FROM rakeback_advances ra
     LEFT JOIN clubs c ON c.id = ra.club_origen_id
     WHERE ra.active = true AND ra.amount <> ra.consumed
     ORDER BY ra.created_at`
  );

  const balancesPorAgente = new Map<string, any[]>();
  for (const row of balancesRes.rows) {
    const lista = balancesPorAgente.get(row.agent_id) ?? [];
    lista.push(row);
    balancesPorAgente.set(row.agent_id, lista);
  }
  const adelantosPorAgente = new Map<string, any[]>();
  for (const row of adelantosRes.rows) {
    const lista = adelantosPorAgente.get(row.agent_id) ?? [];
    lista.push(row);
    adelantosPorAgente.set(row.agent_id, lista);
  }

  return agentesRes.rows.map((a: any) => {
    const balances = balancesPorAgente.get(a.id) ?? [];
    const saldoPorClub = balances.map((b: any) => {
      const saldoNeto = b.system === "PREPAGO" ? Number(b.amount) + Number(b.total_fichas_ganadas_mesas) : Number(b.amount);
      return {
        clubId: b.club_id,
        clubName: b.club_name,
        system: b.system,
        amount: Number(b.amount),
        totalFichasGanadasMesas: Number(b.total_fichas_ganadas_mesas),
        saldoNeto,
      };
    });
    const saldoNetoTotal = saldoPorClub.reduce((s, b) => s + b.saldoNeto, 0);

    const adelantosRows = adelantosPorAgente.get(a.id) ?? [];
    const adelantos = adelantosRows.map((r: any) => ({
      id: r.id,
      amount: Number(r.amount),
      consumed: Number(r.consumed),
      disponible: Number(r.amount) - Number(r.consumed),
      medio: r.medio ?? null,
      clubOrigenName: r.club_origen_name ?? null,
      notes: r.notes ?? null,
      createdAt: r.created_at,
    }));
    const adelantosPendientes = adelantos.reduce((s, r) => s + r.disponible, 0);

    return {
      agentId: a.id,
      agentName: a.name,
      defaultSystem: a.default_system,
      supervisor: a.supervisor ?? null,
      saldoPorClub,
      saldoNetoTotal,
      adelantos,
      adelantosPendientes,
      saldoReal: saldoNetoTotal - adelantosPendientes,
    };
  });
}

// Semanas con al menos un cierre aplicado (para el selector del PDF) -- distinct week_start
// entre todos los agentes, más reciente primero.
export async function listSemanasConResumenAgente(): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT week_start FROM weekly_closings WHERE status <> 'REVERTIDO' ORDER BY week_start DESC LIMIT 52`
  );
  return r.rows.map((row: any) => String(row.week_start).slice(0, 10));
}

// Historial de resúmenes guardados (30/09/2026, pedido de Leo) -- ver comentario en
// db/schema.sql (tabla agente_resumenes_guardados). Guarda/lista/borra fotos congeladas del
// objeto `preview` que arma el frontend (combinarResumen en ResumenAgentes.tsx), igual patrón
// que liquidaciones_guardadas pero sin nada de lo que ESA tabla necesita para pagos/cruces --
// un resumen es de solo lectura, guardarlo no tiene ningún efecto en el ledger.
export interface GuardarResumenInput {
  nombreGrupo: string;
  agentIds: string[];
  weekStart: string;
  weekEnd: string;
  sistema: "WIN_LOSE" | "PREPAGO";
  data: unknown;
  createdBy?: string | null;
}

export async function guardarResumenHistorial(input: GuardarResumenInput) {
  const r = await pool.query(
    `INSERT INTO agente_resumenes_guardados (id, nombre_grupo, agent_ids, week_start, week_end, sistema, data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
    [
      `arg_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      input.nombreGrupo,
      input.agentIds,
      input.weekStart,
      input.weekEnd,
      input.sistema,
      JSON.stringify(input.data),
      input.createdBy ?? null,
    ]
  );
  return r.rows[0];
}

// Filtro de fechas (pedido de Leo: "asi de ultima no vemos las viejas y evitamos confusiones",
// mientras se está probando el sistema) -- filtra por created_at (cuándo se guardó la foto, no
// por week_start/week_end de la semana que describe) porque el objetivo es no ver ruido de
// pruebas viejas, no filtrar por contenido.
export async function listResumenesHistorial(desde?: string, hasta?: string) {
  const condiciones: string[] = [];
  const params: any[] = [];
  if (desde) {
    params.push(desde);
    condiciones.push(`created_at >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const r = await pool.query(
    `SELECT id, nombre_grupo, agent_ids, week_start, week_end, sistema, created_by, created_at
     FROM agente_resumenes_guardados ${where} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  return r.rows;
}

export async function getResumenHistorialById(id: string) {
  const r = await pool.query(`SELECT * FROM agente_resumenes_guardados WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

// Borrado real -- para limpiar pruebas (pedido explícito de Leo, mismo criterio que
// DELETE /liquidacion/historial/:id). No tiene ningún efecto en el ledger: guardar/borrar un
// resumen es puramente de archivo, no mueve plata ni pendientes.
export async function eliminarResumenHistorial(id: string) {
  const r = await pool.query(`DELETE FROM agente_resumenes_guardados WHERE id = $1 RETURNING id`, [id]);
  return (r.rowCount ?? 0) > 0;
}
