// Cuentas consolidadas para supervisores (30/09/2026, pedido de Leo: "Edwar es un super
// agente, todo lo que pase con sus agentes va todo al mismo lugar"). Sistema DELIBERADAMENTE
// aislado de agents/balances/weekly_closings/rakeback_pendiente/closings.ts -- mismo criterio
// de separación que se usó para proveedores.ts, para no arriesgar el motor de cierres de todos
// los demás agentes que NO son cuenta consolidada. Ver src/db/schema.sql para el detalle de
// cada tabla.
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";
import { registrarAjusteTesoreria, revertirAjusteTesoreria } from "./treasury.js";
import { getResumenAgentePDF } from "./agentesResumen.js";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Supervisor WIN/LOSE (20/10/2026, pedido de Leo: "creemos los supervisores Win/Lose separados", piloto: Agustin).
// Se marca con el campo que ya existe "Sistema por defecto" (agents.default_system = 'WIN_LOSE'): no hace falta
// ninguna columna nueva. A diferencia de un supervisor Prepago (fichas reales + cuenta corriente), uno Win/Lose
// tiene UNA sola cuenta, la cuenta corriente: sus agentes juegan con fichas del club y nunca compraron nada, así
// que el cierre COMPLETO de cada semana (resultado + rakeback + rebate + rodeo + ajuste, o sea weekly_closings.
// final_closing -- el mismo número que hoy viaja al "pendiente" en Liquidaciones) va a cuenta corriente, y
// fichas_reales no se usa. Se salda con Pagar/Cobrar en USDT. Sin Carga/Descarga.
export function esSupervisorWinLose(sup: { default_system?: string | null } | null | undefined): boolean {
  return sup?.default_system === "WIN_LOSE";
}

// Trae (con lock FOR UPDATE) la cuenta consolidada de un supervisor, creándola en 0/0 si es la
// primera vez que se le registra algo (el alta "de verdad", con el saldo histórico migrado, la
// hace migrarSaldoHistoricoSupervisor -- si ese paso corre antes de cualquier movimiento manual,
// esta función simplemente encuentra la fila ya creada y no la pisa).
async function getCuentaParaUpdate(client: PoolClient, supervisorAgentId: string) {
  const existing = await client.query(
    `SELECT * FROM supervisor_cuentas WHERE supervisor_agent_id = $1 FOR UPDATE`,
    [supervisorAgentId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await client.query(
    `INSERT INTO supervisor_cuentas (id, supervisor_agent_id, fichas_reales, cuenta_corriente) VALUES ($1,$2,0,0) RETURNING *`,
    [newId("svcta"), supervisorAgentId]
  );
  return r.rows[0];
}

export async function listSupervisoresConsolidados() {
  const r = await pool.query(
    `SELECT a.*, COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente,
            sc.updated_at as cuenta_updated_at,
            (SELECT COUNT(*)::int FROM agents sub WHERE sub.supervisor = a.name) as n_sub
     FROM agents a
     LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
     WHERE a.usa_cuenta_consolidada = true
       AND (a.account_type = 'SUPERVISOR' OR EXISTS (SELECT 1 FROM agents sub WHERE sub.supervisor = a.name))
     ORDER BY a.name`
  );
  return r.rows;
}

export async function getSupervisorConCuenta(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT a.*, COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente,
            sc.updated_at as cuenta_updated_at
     FROM agents a LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
     WHERE a.id = $1`,
    [supervisorAgentId]
  );
  return r.rows[0] ?? null;
}

// Agentes cuyo campo "Supervisor" apunta a este (resuelto por nombre, mismo criterio que ya
// usa rebate_destino=RAKEBACK_SUPERVISOR) -- nunca tienen saldo/cierre propio mientras la
// cuenta consolidada esté activa; esto es SOLO para mostrar quiénes son (lectura/auditoría).
export async function listSubordinados(supervisorAgentId: string) {
  const cuenta = await agentesDeLaCuenta(supervisorAgentId);
  if (!cuenta) return [];
  // cc_agente: la cuenta corriente de cada agente dentro de la cuenta del titular, la misma que muestra la tabla "Fichas en
  // tiempo real por agente" (listSaldosPorAgenteSupervisor: migración + movimientos aplicados + rakeback de cierres). Los
  // agentes que ya no son subordinados quedan afuera; lo que no tiene agente asignado no se reparte.
  const saldos = await listSaldosPorAgenteSupervisor(supervisorAgentId);
  const porAgente = new Map<string, number>(saldos.filter((f) => f.agentId).map((f) => [f.agentId as string, f.cuentaCorriente]));
  return cuenta.agentes.map((a: any) => ({ ...a, cc_agente: round2(porAgente.get(a.id) ?? 0) }));
}

// Cuenta de un AGENTE INDIVIDUAL (20/10/2026, pedido de Leo: "crearia la seccion Agentes", mismo sistema que los
// supervisores Prepago/Win/Lose): el titular no es un supervisor y no tiene agentes a cargo, así que la cuenta
// consolida sus propios cierres -- el único "agente de la cuenta" es él mismo. Reusa las mismas tablas
// supervisor_cuentas/movimientos/cierres/migración: el titular siempre es agents.id de quien tiene
// usa_cuenta_consolidada, sea supervisor o agente. NO hay otra marca: es individual si no es SUPERVISOR y nadie
// le reporta (un supervisor mal tipeado con agentes a cargo, como JD, sigue siendo supervisor).
export async function agentesDeLaCuenta(ownerId: string) {
  const owner = await pool.query(`SELECT * FROM agents WHERE id = $1`, [ownerId]);
  if (!owner.rows[0]) return null;
  const subs = await pool.query(`SELECT * FROM agents WHERE supervisor = $1 ORDER BY name`, [owner.rows[0].name]);
  const individual = owner.rows[0].account_type !== "SUPERVISOR" && subs.rows.length === 0;
  return {
    owner: owner.rows[0],
    individual,
    agentes: individual ? [owner.rows[0]] : subs.rows,
    // Los agentes "solo de referencia" no suman ni restan en la cuenta: se dejan fuera de los cierres que se aplican.
    ids: (individual ? [owner.rows[0]] : subs.rows).filter((a: any) => !a.solo_referencia).map((a: any) => a.id as string),
  };
}

// Cuentas de agentes individuales (sección "Agentes"): con cuenta consolidada, no supervisor y sin nadie a cargo.
export async function listCuentasAgentes() {
  const r = await pool.query(
    `SELECT a.*, COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente,
            sc.updated_at as cuenta_updated_at, 0 as n_sub
     FROM agents a
     LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
     WHERE a.usa_cuenta_consolidada = true AND a.account_type <> 'SUPERVISOR'
       AND NOT EXISTS (SELECT 1 FROM agents sub WHERE sub.supervisor = a.name)
     ORDER BY a.name`
  );
  return r.rows;
}

// Datos para bajar los PDFs de las cuentas de agentes (cierre semanal, estado de cuenta o todo junto) -- el PDF se arma
// en el navegador (jsPDF) con esto. Una entrada por cuenta de agente con: saldo, fichas por club, el cierre de la semana
// elegida con sus descuentos, y los últimos movimientos aplicados. Solo lectura.
export async function datosPdfCuentasAgentes(weekStart?: string | null) {
  const cuentas = await listCuentasAgentes();
  const semanasMap = new Map<string, { week_start: string; week_end: string }>();
  for (const c of cuentas) {
    for (const s of await getSemanasDisponiblesSupervisor(c.id)) {
      const ws = String(s.week_start).slice(0, 10);
      if (!semanasMap.has(ws)) semanasMap.set(ws, { week_start: ws, week_end: String(s.week_end).slice(0, 10) });
    }
  }
  const semanas = [...semanasMap.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
  const semana = weekStart ?? semanas[0]?.week_start ?? null;
  const semanaFin = semanas.find((s) => s.week_start === semana)?.week_end ?? null;

  const out = [];
  for (const c of cuentas) {
    const winLose = esSupervisorWinLose(c);
    const saldos = await listSaldosPorAgenteSupervisor(c.id);
    const mio = saldos.find((x) => x.agentId === c.id);
    const movs = (await listMovimientosSupervisor(c.id)).filter((m: any) => m.status === "APLICADO").slice(0, 40);
    let cierre: any = null;
    let descuentos: any[] = [];
    if (semana) {
      const ci = await getCierreSemanalSupervisor(c.id, semana);
      const linea = ci.lineas.find((l: any) => l.agent_id === c.id);
      cierre = {
        filas: linea?.detalle ?? [],
        total: round2(Number(linea?.total ?? 0)),
        resultado: round2(Number(linea?.result ?? 0)),
        rakeback: round2(Number(linea?.rakeback ?? 0)),
        aplicado: !!ci.aplicado,
        yaIncluidoEnSaldo: (ci.agentesYaIncluidosEnSaldo ?? []).includes(c.name),
      };
      descuentos = movs
        .filter((m: any) => m.type === "DESCUENTO" && m.semana && String(m.semana).slice(0, 10) === semana)
        .map((m: any) => ({ concepto: m.concepto, amount: Number(m.amount), notes: m.notes }));
    }
    out.push({
      agentId: c.id,
      name: c.name,
      sistema: winLose ? "WIN_LOSE" : "PREPAGO",
      fichas: Number(c.fichas_reales),
      cuentaCorriente: Number(c.cuenta_corriente),
      porClub: (mio?.detallePorClub ?? []).map((d) => ({ club: d.clubName, balance: d.balance, mesas: d.mesas, fichas: d.fichas })),
      cierre,
      descuentos,
      movimientos: movs.map((m: any) => ({
        fecha: m.occurred_at,
        type: m.type,
        club: m.club_name,
        amount: Number(m.amount),
        fichasDelta: Number(m.fichas_reales_delta),
        ccDelta: Number(m.cuenta_corriente_delta),
        concepto: m.concepto,
        notes: m.notes,
        usdtReal: !!m.usdt_real,
      })),
    });
  }
  return { semana, semanaFin, semanas, cuentas: out };
}

// "Mi cuenta" del portal para un agente CON cuenta propia (20/10/2026, pedido de Leo: que el usuario vea lo mismo que se
// ve en Agentes, con el desglose de cada cierre como en TeamBack Afiliados): saldo de la cuenta, fichas por club, los
// cierres semanales con su desglose por club y por jugador, y los movimientos de la cuenta. Solo lectura y solo del
// propio agente. Del desglose NO se devuelve nada interno (subagentes, trato de la casa): únicamente lo que ya es suyo.
export async function getMiCuentaAgente(agentId: string) {
  const sup = await getSupervisorConCuenta(agentId);
  if (!sup) throw new Error("Agente no encontrado.");
  const winLose = esSupervisorWinLose(sup);
  const saldos = await listSaldosPorAgenteSupervisor(agentId);
  const mio = saldos.find((s) => s.agentId === agentId);

  const wcs = await pool.query(
    `SELECT wc.id, wc.week_start, wc.week_end, wc.system, wc.jugadores, wc.result, wc.rake_total, wc.rakeback_pct,
            wc.rakeback, wc.rebate, wc.rodeo, wc.final_closing, c.name as club_name
     FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE wc.agent_id = $1 AND wc.status <> 'REVERTIDO'
     ORDER BY wc.week_start DESC, c.name
     LIMIT 80`,
    [agentId]
  );
  const ids = wcs.rows.map((r) => r.id);
  const jug = ids.length
    ? (
        await pool.query(
          `SELECT closing_id, player_external_id, player_name, resultado, rake, rebate, rakeback_pct, rakeback, cierre_jugador
           FROM weekly_closing_player_details WHERE closing_id = ANY($1::text[]) ORDER BY rake DESC, player_name`,
          [ids]
        )
      ).rows
    : [];
  const aplicadas = await pool.query(
    `SELECT week_start FROM supervisor_cierres WHERE supervisor_agent_id = $1 AND status <> 'REVERTIDO'`,
    [agentId]
  );
  const aplicadasSet = new Set(aplicadas.rows.map((r) => String(r.week_start).slice(0, 10)));
  const corteRes = await pool.query(
    `SELECT MAX(semana_corte) as corte FROM supervisor_migracion_historica WHERE supervisor_agent_id = $1`,
    [agentId]
  );
  const corte: string | null = corteRes.rows[0]?.corte ? String(corteRes.rows[0].corte).slice(0, 10) : null;
  const primeraAplicada = [...aplicadasSet].sort()[0] ?? null;

  const estadoSemana = (ws: string): "INCLUIDO" | "APLICADO" | "ANTERIOR" | "PENDIENTE" => {
    if (corte && ws <= corte) return "INCLUIDO";
    if (aplicadasSet.has(ws)) return "APLICADO";
    if (!corte && primeraAplicada && ws < primeraAplicada) return "ANTERIOR";
    return "PENDIENTE";
  };

  const semanas = new Map<string, any>();
  for (const r of wcs.rows) {
    const ws = String(r.week_start).slice(0, 10);
    if (!semanas.has(ws)) {
      semanas.set(ws, { week_start: ws, week_end: String(r.week_end).slice(0, 10), estado: estadoSemana(ws), total: 0, resultado: 0, rakeback: 0, rebate: 0, clubes: [] as any[] });
    }
    const s = semanas.get(ws);
    s.total = round2(s.total + Number(r.final_closing));
    s.resultado = round2(s.resultado + Number(r.result));
    s.rakeback = round2(s.rakeback + Number(r.rakeback));
    s.rebate = round2(s.rebate + Number(r.rebate));
    s.clubes.push({
      club: r.club_name,
      jugadores: r.jugadores,
      resultado: Number(r.result),
      rake: Number(r.rake_total),
      rakeback_pct: Number(r.rakeback_pct),
      rakeback: Number(r.rakeback),
      rebate: Number(r.rebate),
      rodeo: Number(r.rodeo),
      total: Number(r.final_closing),
      jugadores_detalle: jug
        .filter((j) => j.closing_id === r.id)
        .map((j) => ({
          id: j.player_external_id,
          nombre: j.player_name,
          resultado: Number(j.resultado),
          rake: Number(j.rake),
          rebate: Number(j.rebate),
          rakeback_pct: Number(j.rakeback_pct),
          rakeback: Number(j.rakeback),
          cierre: Number(j.cierre_jugador),
        })),
    });
  }

  const movs = (await listMovimientosSupervisor(agentId))
    .filter((m: any) => m.status === "APLICADO")
    .slice(0, 100)
    .map((m: any) => ({
      id: m.id,
      type: m.type,
      club_name: m.club_name,
      amount: Number(m.amount),
      fichas_reales_delta: Number(m.fichas_reales_delta),
      cuenta_corriente_delta: Number(m.cuenta_corriente_delta),
      concepto: m.concepto,
      semana: m.semana ? String(m.semana).slice(0, 10) : null,
      notes: m.notes,
      payment_link: m.payment_link,
      usdt_real: !!m.usdt_real,
      occurred_at: m.occurred_at,
    }));

  return {
    sistema: winLose ? "WIN_LOSE" : "PREPAGO",
    fichas_reales: Number(sup.fichas_reales),
    cuenta_corriente: Number(sup.cuenta_corriente),
    por_club: (mio?.detallePorClub ?? []).map((d) => ({ club: d.clubName, balance: d.balance, mesas: d.mesas, fichas: d.fichas })),
    semanas: [...semanas.values()],
    movimientos: movs,
  };
}

// Agentes que están DENTRO de la cuenta de un supervisor (21/10/2026, pedido de Leo: las tablas del Resumen tienen que
// reflejar los saldos de Supervisores y Agentes): lo que tienen se cuenta en la cuenta de su supervisor, no por separado.
export async function agentesEnCuentasDeSupervisor(): Promise<string[]> {
  const r = await pool.query(
    `SELECT ag.id FROM agents ag JOIN agents su ON su.name = ag.supervisor
     WHERE su.usa_cuenta_consolidada = true
       AND (su.account_type = 'SUPERVISOR' OR EXISTS (SELECT 1 FROM agents s WHERE s.supervisor = su.name))`
  );
  return r.rows.map((x) => x.id as string);
}

// Una fila por cuenta (supervisores y agentes individuales) para el Resumen: saldo = fichas reales + cuenta corriente en
// Prepago, solo cuenta corriente en Win/Lose (mismo criterio que calcularSaldoFinanciero).
export async function listCuentasParaResumen() {
  const filas: {
    id: string; name: string; tipo: "SUPERVISOR" | "AGENTE"; system: "PREPAGO" | "WIN_LOSE";
    fichas: number; cuentaCorriente: number; saldo: number; agentes: number;
  }[] = [];
  const mapear = (r: any, tipo: "SUPERVISOR" | "AGENTE") => {
    const system = esSupervisorWinLose(r) ? "WIN_LOSE" : "PREPAGO";
    const fichas = Number(r.fichas_reales);
    const cc = Number(r.cuenta_corriente);
    filas.push({
      id: r.id, name: r.name, tipo, system, fichas, cuentaCorriente: cc,
      saldo: round2(system === "PREPAGO" ? fichas + cc : cc),
      agentes: tipo === "SUPERVISOR" ? Number(r.n_sub ?? 0) : 1,
    });
  };
  for (const r of await listSupervisoresConsolidados()) mapear(r, "SUPERVISOR");
  for (const r of await listCuentasAgentes()) mapear(r, "AGENTE");
  return filas;
}

// Agentes individuales que todavía no tienen cuenta y se pueden activar (activos, sin supervisor, sin nadie a cargo).
export async function listAgentesSinCuenta() {
  const r = await pool.query(
    `SELECT a.id, a.name, a.account_type, a.default_system
     FROM agents a
     WHERE a.active = true AND a.usa_cuenta_consolidada = false AND a.account_type <> 'SUPERVISOR'
       AND COALESCE(a.supervisor, '') = '' AND a.solo_referencia = false
       AND NOT EXISTS (SELECT 1 FROM agents sub WHERE sub.supervisor = a.name)
     ORDER BY a.name`
  );
  return r.rows;
}

// Espejo de fichas en balances (cuenta de agente individual Prepago, 20/10/2026): la cuenta es donde se opera, pero
// balances sigue siendo lo que leen Resumen por club y los KPIs, así que cada Carga/Descarga/Ajuste de fichas suma o
// resta también ahí (misma fila agente+club que usa el ledger de siempre). Nunca crea un movimiento en ledger_movements.
async function espejarFichasEnBalance(client: PoolClient, agentId: string, clubId: string, delta: number) {
  await client.query(
    `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (agent_id, club_id)
     DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
    [newId("bal"), agentId, clubId, delta]
  );
}

// ¿Este agente tiene cuenta propia en la sección Agentes? Se usa para bloquear "Cargar movimiento" (se carga desde su cuenta).
export async function agenteTieneCuentaPropia(agentId: string): Promise<{ tiene: boolean; name: string | null }> {
  const a = await pool.query(`SELECT name, usa_cuenta_consolidada FROM agents WHERE id = $1`, [agentId]);
  if (!a.rows[0] || !a.rows[0].usa_cuenta_consolidada) return { tiene: false, name: a.rows[0]?.name ?? null };
  const cuenta = await agentesDeLaCuenta(agentId);
  return { tiene: !!cuenta?.individual, name: a.rows[0].name };
}

// Activa la cuenta de un agente individual (sección "Agentes"). No mueve plata ni toca sus balances/cierres: solo lo
// marca para que su cuenta exista; el saldo inicial se trae después con "Importar saldo".
export async function activarCuentaAgente(agentId: string) {
  const elegibles = await listAgentesSinCuenta();
  const ag = elegibles.find((a: any) => a.id === agentId);
  if (!ag) throw new Error("Ese agente no se puede activar (tiene que estar activo, sin supervisor y sin agentes a cargo).");
  const modelo = ag.default_system === "WIN_LOSE" || ag.account_type === "WIN_LOSE" ? "WIN_LOSE" : "PREPAGO";
  await pool.query(
    `UPDATE agents SET usa_cuenta_consolidada = true, modelo_cuenta = $2, consolidar_cierres = true,
            exigir_agente_en_movimientos = false, updated_at = now() WHERE id = $1`,
    [agentId, modelo]
  );
  return getSupervisorConCuenta(agentId);
}

export interface MovimientoSupervisorInput {
  supervisorAgentId: string;
  /** Obligatorio salvo en PAGO/COBRO (esos van directo contra la cuenta corriente, sin club). */
  clubId?: string | null;
  /** Informativo únicamente (gateado por agents.exigir_agente_en_movimientos del supervisor) --
   * JAMÁS genera saldo propio para este agente. */
  agentId?: string | null;
  type: "CARGA" | "DESCARGA" | "AJUSTE" | "PAGO" | "COBRO" | "DESCUENTO";
  /** Solo DESCUENTO (cuentas de agentes): en qué concepto se descuenta (adelanto de fichas, venta, ticket, etc.) y,
   * opcional, la semana del cierre (YYYY-MM-DD, lunes) a la que corresponde. */
  concepto?: string | null;
  semana?: string | null;
  /** PAGO/COBRO (19/10/2026, pedido de Leo): USDT real contra la cuenta corriente del supervisor -- PAGO = le mandamos
   * plata (resta de cuenta_corriente, EGRESO de Wallet Manos), COBRO = nos manda plata (suma a cuenta_corriente,
   * INGRESO a Wallet Manos). No tocan fichas_reales ni piden club. CARGA/DESCARGA: siempre > 0 (el signo lo define el type, ver reclasificación de Leo).
   * AJUSTE: puede ser positivo o negativo, aplicado directo al campo elegido en campoAjuste. */
  amount: number;
  /** Solo para type AJUSTE: a qué lado de la cuenta pega. */
  campoAjuste?: "FICHAS" | "CUENTA_CORRIENTE";
  /** Si además hubo una transferencia real de USDT (no solo reclasificación interna) -- ver
   * Wallet Manos, pedido explícito de Leo: nunca tocarlo salvo que esto sea true. */
  usdtReal?: boolean;
  notes?: string | null;
  /** Link de pago/trackeo de la transferencia (16/10/2026, pedido de Leo) -- queda guardado en
   * supervisor_movimientos.payment_link, visible para el supervisor en su propio historial
   * (Mi Supervisión). Opcional: una Carga/Descarga manual sigue funcionando igual sin esto. */
  paymentLink?: string | null;
  createdBy?: string | null;
}

// Carga/Descarga SIN usdtReal (reclasificación interna, no entra ni sale plata de verdad):
// mueven fichas_reales y cuenta_corriente en espejo exacto -- Carga fichas_reales += importe,
// cuenta_corriente -= importe; Descarga al revés (corregido 15/10/2026, Leo: "las cargas y
// descargas son movimientos internos, no ganancias ni pérdidas" -- revierte la corrección del
// 30/09/2026, que hacía que la descarga comiera primero de cuenta_corriente y terminara bajando
// el saldo total en vez de ser neutra). Carga/Descarga CON usdtReal=true (corregido 15/10/2026,
// caso Rodrigo/lolxdjiji, Leo: "esas fichas fueron pagadas, no deberían haber sumado a la cuenta
// corriente"): es plata real que entra o sale por Wallet Manos, no una reclasificación interna --
// solo mueven fichas_reales, cuenta_corriente queda intacta (el otro lado de la partida es el
// asiento de tesorería de abajo, no el pool interno del supervisor). En ningún caso (con o sin
// usdtReal) una carga/descarga cambia el saldo total fichas+cc por sí sola; eso solo pasa con
// resultado de mesas o cierres reales. Ajuste: mueve un solo lado a mano, con el signo que se
// indique (para correcciones puntuales que no son ni una carga ni una descarga real) y NUNCA
// mueve Wallet Manos, sin importar qué mande el frontend (mismo criterio que ya usa
// AJUSTE/SIN_TESORERIA en repo/ledger.ts). Nunca toca balances/ledger_movements de ningún agente.
export async function registrarMovimientoSupervisor(input: MovimientoSupervisorInput) {
  const sup = await pool.query(`SELECT * FROM agents WHERE id = $1`, [input.supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  if (!sup.rows[0].usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");
  // Win/Lose (20/10/2026, pedido de Leo): un Pagar/Cobrar se hace sobre TODO el grupo junto, así que ahí el agente es
  // opcional aunque el supervisor lo exija en los demás movimientos. Si no se indica, el movimiento queda en la fila
  // "Sin agente asignado" del desglose por agente (nunca se reparte a ciegas), y el total de la cuenta no cambia.
  const pagoCobroGrupal = esSupervisorWinLose(sup.rows[0]) && (input.type === "PAGO" || input.type === "COBRO");
  // Cuenta de agente individual: todo movimiento es de ese mismo agente, no hace falta elegirlo.
  const cuentaAgente = await agentesDeLaCuenta(input.supervisorAgentId);
  const individual = !!cuentaAgente?.individual;
  if (individual && !input.agentId) input.agentId = input.supervisorAgentId;
  if (sup.rows[0].exigir_agente_en_movimientos && !input.agentId && !pagoCobroGrupal && !individual) {
    throw new Error("Este supervisor exige indicar el agente de origen del movimiento.");
  }
  if (esSupervisorWinLose(sup.rows[0])) {
    if (input.type === "CARGA" || input.type === "DESCARGA") {
      throw new Error("Una cuenta Win/Lose no maneja fichas: usá Pagar, Cobrar, un Descuento o un Ajuste de cuenta corriente.");
    }
    if (input.type === "AJUSTE" && input.campoAjuste !== "CUENTA_CORRIENTE") {
      throw new Error("Una cuenta Win/Lose solo tiene cuenta corriente: el ajuste tiene que ser de cuenta corriente.");
    }
  }
  if (input.type === "DESCUENTO" && !individual) {
    throw new Error("Los descuentos del cierre son de las cuentas de agentes.");
  }
  if (input.type === "DESCUENTO" && !input.concepto?.trim()) {
    throw new Error("Indicá el concepto del descuento (adelanto de fichas, venta, ticket, etc.).");
  }

  let amount = 0;
  const esPagoCobro = input.type === "PAGO" || input.type === "COBRO";
  const sinClub = esPagoCobro || input.type === "DESCUENTO";
  if (!sinClub && !input.clubId) throw new Error("El club es obligatorio.");
  if (input.type === "CARGA" || input.type === "DESCARGA" || esPagoCobro || input.type === "DESCUENTO") {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("El importe debe ser mayor a 0.");
    amount = round2(input.amount);
  } else if (input.type === "AJUSTE") {
    if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("El importe del ajuste no puede ser 0.");
    if (!input.campoAjuste) throw new Error("El ajuste necesita indicar a qué campo se aplica (fichas o cuenta corriente).");
  } else {
    throw new Error("Tipo de movimiento inválido.");
  }

  // Forzado acá (único punto donde se decide si se abre un asiento de tesorería), no confía en
  // lo que mande el frontend.
  const usdtReal = esPagoCobro || (input.type !== "AJUSTE" && input.type !== "DESCUENTO" && !!input.usdtReal);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cuenta = await getCuentaParaUpdate(client, input.supervisorAgentId);
    const fichasAnterior = Number(cuenta.fichas_reales);
    const ccAnterior = Number(cuenta.cuenta_corriente);

    let fichasDelta = 0;
    let ccDelta = 0;
    if (input.type === "CARGA") {
      fichasDelta = amount;
      ccDelta = usdtReal ? 0 : -amount;
    } else if (input.type === "PAGO") {
      ccDelta = round2(-amount);
    } else if (input.type === "COBRO") {
      ccDelta = amount;
    } else if (input.type === "DESCUENTO") {
      // Descuento del cierre: baja la cuenta corriente (adelanto/venta/ticket que se le dio al agente), sin mover Wallet.
      ccDelta = round2(-amount);
    } else if (input.type === "DESCARGA") {
      fichasDelta = round2(-amount);
      ccDelta = usdtReal ? 0 : round2(amount);
    } else {
      const ajusteAmount = round2(input.amount);
      if (input.campoAjuste === "FICHAS") fichasDelta = ajusteAmount;
      else ccDelta = ajusteAmount;
    }

    // Transferencia real de USDT además de la reclasificación interna de arriba: Carga = nos
    // entró plata de verdad (INGRESO a Wallet Manos), Descarga = le mandamos plata de verdad
    // (EGRESO). No es atómico con esta transacción -- mismo criterio ya usado en
    // pagarComisionesReferido/pagarCierreBancado (repo/supervisorReferidos.ts,
    // repo/bancados.ts): si algo falla después, el asiento de Wallet queda igual, auditable, y
    // se puede revertir a mano.
    let treasuryAdjustmentId: string | null = null;
    if (usdtReal) {
      const direction = input.type === "CARGA" || input.type === "COBRO" ? "INGRESO" : "EGRESO";
      const { id: adjId } = await registrarAjusteTesoreria({
        ledger: "WALLET_MANOS",
        direction,
        amount,
        reason: `Supervisor ${sup.rows[0].name} — ${input.type.toLowerCase()} US$ ${amount.toFixed(2)}`,
        createdBy: input.createdBy ?? null,
      });
      treasuryAdjustmentId = adjId;
    }

    const fichasNuevo = round2(fichasAnterior + fichasDelta);
    const ccNuevo = round2(ccAnterior + ccDelta);

    const id = newId("svmov");
    await client.query(
      `INSERT INTO supervisor_movimientos
        (id, supervisor_agent_id, club_id, agent_id, type, amount, fichas_reales_delta, cuenta_corriente_delta,
         usdt_real, treasury_adjustment_id, saldo_anterior_fichas, saldo_anterior_cc, saldo_nuevo_fichas, saldo_nuevo_cc,
         notes, payment_link, created_by, concepto, semana)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id, input.supervisorAgentId, input.clubId ?? null, input.agentId ?? null, input.type, round2(input.amount),
        fichasDelta, ccDelta, usdtReal, treasuryAdjustmentId, fichasAnterior, ccAnterior, fichasNuevo, ccNuevo,
        input.notes ?? null, input.paymentLink ?? null, input.createdBy ?? null,
        input.type === "DESCUENTO" ? input.concepto!.trim() : null, input.type === "DESCUENTO" ? input.semana ?? null : null,
      ]
    );
    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasNuevo, ccNuevo, cuenta.id]
    );
    // Cuenta de agente individual: las fichas por club se reflejan también en su balance de siempre, así Resumen por club
    // y el resto de los reportes que leen balances siguen mostrando lo mismo.
    if (individual && input.clubId && fichasDelta !== 0) {
      await espejarFichasEnBalance(client, input.supervisorAgentId, input.clubId, fichasDelta);
    }
    await client.query("COMMIT");
    return { id, fichasAnterior, ccAnterior, fichasNuevo, ccNuevo, treasuryAdjustmentId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMovimientosSupervisor(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT sm.*, c.name as club_name, a.name as agent_name
     FROM supervisor_movimientos sm
     LEFT JOIN clubs c ON c.id = sm.club_id
     LEFT JOIN agents a ON a.id = sm.agent_id
     WHERE sm.supervisor_agent_id = $1
     ORDER BY sm.occurred_at DESC`,
    [supervisorAgentId]
  );
  return r.rows;
}

// Revierte un movimiento manual cargado por error -- LEDGER INMUTABLE, no lo borra: aplica el
// delta contrario sobre la cuenta y marca REVERTIDO (mismo criterio que revertirPagoProveedor).
export async function revertirMovimientoSupervisor(movimientoId: string) {
  const client = await pool.connect();
  let treasuryAdjustmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const movRes = await client.query(`SELECT * FROM supervisor_movimientos WHERE id = $1 FOR UPDATE`, [movimientoId]);
    const mov = movRes.rows[0];
    if (!mov) throw new Error("Movimiento no encontrado.");
    if (mov.status === "REVERTIDO") throw new Error("Este movimiento ya estaba revertido.");

    const cuenta = await getCuentaParaUpdate(client, mov.supervisor_agent_id);
    const fichasAnterior = Number(cuenta.fichas_reales);
    const ccAnterior = Number(cuenta.cuenta_corriente);
    const fichasNuevo = round2(fichasAnterior - Number(mov.fichas_reales_delta));
    const ccNuevo = round2(ccAnterior - Number(mov.cuenta_corriente_delta));

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasNuevo, ccNuevo, cuenta.id]
    );
    await client.query(`UPDATE supervisor_movimientos SET status = 'REVERTIDO' WHERE id = $1`, [movimientoId]);
    // Deshace el espejo en el balance del agente (ver registrarMovimientoSupervisor) si era una cuenta de agente individual.
    const cuentaMov = await agentesDeLaCuenta(mov.supervisor_agent_id);
    if (cuentaMov?.individual && mov.club_id && Number(mov.fichas_reales_delta) !== 0) {
      await espejarFichasEnBalance(client, mov.supervisor_agent_id, mov.club_id, -Number(mov.fichas_reales_delta));
    }
    await client.query("COMMIT");
    treasuryAdjustmentId = mov.treasury_adjustment_id ?? null;
    return { id: movimientoId, fichasNuevo, ccNuevo };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    // Si el movimiento había tocado Wallet Manos de verdad (usdt_real), revierte también ese
    // asiento -- no es atómico con lo de arriba (mismo criterio explicado en
    // registrarMovimientoSupervisor); revertirAjusteTesoreria es segura de llamar dos veces:
    // si ya estuviera revertido tira error en vez de duplicar la reversa.
    if (treasuryAdjustmentId) {
      await revertirAjusteTesoreria(treasuryAdjustmentId, `Reversión de movimiento de supervisor ${movimientoId}`);
    }
  }
}

// Corrección histórica (una sola vez, por supervisor): cuando se prende usa_cuenta_consolidada
// para un supervisor que YA tenía agentes operando con saldo propio (caso Edwar, confirmado por
// Leo), esto mueve ese saldo acumulado a la cuenta nueva, dejando registro línea por línea en
// supervisor_migracion_historica -- nunca en silencio. NO toca balances/rakeback_pendiente de
// los agentes de origen (quedan tal cual quedaron, como registro histórico de lo que tenían --
// ver nota en el llamado: es el propio Leo quien confirma los montos antes de correr esto,
// según el diagnóstico de diagnosticoSaldoSupervisor.ts).
export interface LineaMigracionHistorica {
  agentId: string;
  clubId?: string | null;
  fichasMigradas: number;
  pendienteMigrado: number;
  notes?: string | null;
  // Importación desde el botón "Importar saldos": el saldo ya incluye los cierres hasta esta semana (YYYY-MM-DD).
  semanaCorte?: string | null;
}
export async function migrarSaldoHistoricoSupervisor(
  supervisorAgentId: string,
  lineas: LineaMigracionHistorica[],
  createdBy?: string | null
) {
  if (lineas.length === 0) throw new Error("No hay líneas para migrar.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cuenta = await getCuentaParaUpdate(client, supervisorAgentId);
    let fichasTotal = Number(cuenta.fichas_reales);
    let ccTotal = Number(cuenta.cuenta_corriente);

    for (const l of lineas) {
      fichasTotal = round2(fichasTotal + l.fichasMigradas);
      ccTotal = round2(ccTotal + l.pendienteMigrado);
      await client.query(
        `INSERT INTO supervisor_migracion_historica
          (id, supervisor_agent_id, agent_id, club_id, fichas_migradas, pendiente_migrado, notes, created_by, semana_corte)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId("svmig"), supervisorAgentId, l.agentId, l.clubId ?? null, l.fichasMigradas, l.pendienteMigrado, l.notes ?? null, createdBy ?? null, l.semanaCorte ?? null]
      );
    }

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasTotal, ccTotal, cuenta.id]
    );
    await client.query("COMMIT");
    return { fichasTotal, ccTotal };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Saldo ACTUAL de un subordinado (01/10/2026, pedido de Leo, caso Uriel: "se va actualizando
// momento a momento" -- al ocultar/mostrar a un agente de la tabla "Agentes a cargo" hay que
// restarle/sumarle a Uriel EXACTAMENTE lo que ese agente tiene EN ESE MOMENTO, no un valor
// guardado de otra vez). Mismo cálculo que diagnosticoSaldoSupervisor.ts/
// migrarSaldoHistoricoUriel.ts: fichas = balance crudo + resultado acumulado de mesas PREPAGO;
// pendiente = rakeback_pendiente activo (amount-consumed). NUNCA toca el balance del agente --
// solo lo lee, para calcular cuánto mover del lado del pool de Uriel.
async function calcularSaldoActualDeSubordinado(
  agentId: string,
  soloPendiente = false
): Promise<{ fichas: number; pendiente: number; clubId: string | null }> {
  const bal = await pool.query(`SELECT club_id, amount FROM balances WHERE agent_id = $1 AND amount <> 0`, [agentId]);
  let balanceTotal = 0;
  let clubId: string | null = null;
  for (const b of bal.rows) {
    balanceTotal += Number(b.amount);
    if (!clubId) clubId = b.club_id;
  }
  const mesas = await pool.query(
    `SELECT COALESCE(SUM(result), 0) as total_mesas FROM weekly_closings WHERE agent_id = $1 AND system = 'PREPAGO' AND status <> 'REVERTIDO'`,
    [agentId]
  );
  // soloPendiente (supervisor Win/Lose): las fichas del agente son operativas del club, no suyas -- no entran.
  const fichas = soloPendiente ? 0 : round2(balanceTotal + Number(mesas.rows[0].total_mesas));

  const pend = await pool.query(
    `SELECT club_id, amount, consumed FROM rakeback_pendiente WHERE agent_id = $1 AND active = true AND ABS(amount - consumed) > 0.004`,
    [agentId]
  );
  let pendienteTotal = 0;
  for (const p of pend.rows) {
    pendienteTotal += Number(p.amount) - Number(p.consumed);
    if (!clubId) clubId = p.club_id;
  }
  return { fichas, pendiente: round2(pendienteTotal), clubId };
}

// Ocultar/mostrar un subordinado (01/10/2026, pedido de Leo, caso Uriel): a diferencia de la
// primera versión (puramente visual, "no mover plata" -- Leo cambió de idea después de probarlo
// en Uriel), esto SÍ mueve el pool: ocultar resta a Uriel el saldo ACTUAL del agente (fichas y
// pendiente), mostrar se lo devuelve recalculado en ESE momento (no el que tenía al ocultarlo --
// confirmado por Leo: "se va actualizando momento a momento"). El agente nunca pierde su propio
// balance -- esto solo mueve el pool de Uriel, vía un AJUSTE automático normal (reversible desde
// "Movimientos manuales", igual que cualquier otro).
export async function setOcultoSubordinado(supervisorAgentId: string, agentId: string, ocultar: boolean, createdBy?: string | null) {
  const sup = await pool.query(`SELECT * FROM agents WHERE id = $1`, [supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  if (!sup.rows[0].usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");

  const ag = await pool.query(`SELECT * FROM agents WHERE id = $1`, [agentId]);
  if (!ag.rows[0]) throw new Error("Agente no encontrado.");
  if (ag.rows[0].supervisor !== sup.rows[0].name) throw new Error("Ese agente no está a cargo de este supervisor.");
  if (!!ag.rows[0].oculto_en_supervisor === ocultar) {
    throw new Error(ocultar ? `"${ag.rows[0].name}" ya está oculto.` : `"${ag.rows[0].name}" ya está visible.`);
  }

  const { fichas, pendiente, clubId } = await calcularSaldoActualDeSubordinado(agentId, esSupervisorWinLose(sup.rows[0]));
  const signo = ocultar ? -1 : 1;
  const clubParaMovimiento = clubId ?? (await pool.query(`SELECT id FROM clubs ORDER BY name LIMIT 1`)).rows[0]?.id ?? null;
  if (!clubParaMovimiento) throw new Error("No hay ningún club cargado todavía -- no se puede registrar el ajuste.");

  const accion = ocultar ? "Ocultar" : "Mostrar";
  const verbo = ocultar ? "se descuenta" : "se devuelve";
  if (Math.abs(fichas) > 0.004) {
    await registrarMovimientoSupervisor({
      supervisorAgentId,
      clubId: clubParaMovimiento,
      agentId,
      type: "AJUSTE",
      amount: round2(fichas * signo),
      campoAjuste: "FICHAS",
      notes: `${accion} a "${ag.rows[0].name}": ${verbo} su saldo actual en fichas del pool (ajuste automático).`,
      createdBy: createdBy ?? null,
    });
  }
  if (Math.abs(pendiente) > 0.004) {
    await registrarMovimientoSupervisor({
      supervisorAgentId,
      clubId: clubParaMovimiento,
      agentId,
      type: "AJUSTE",
      amount: round2(pendiente * signo),
      campoAjuste: "CUENTA_CORRIENTE",
      notes: `${accion} a "${ag.rows[0].name}": ${verbo} su pendiente de rakeback actual del pool (ajuste automático).`,
      createdBy: createdBy ?? null,
    });
  }

  await pool.query(`UPDATE agents SET oculto_en_supervisor = $1, updated_at = now() WHERE id = $2`, [ocultar, agentId]);

  return { fichasMovidas: fichas, pendienteMovido: pendiente };
}

// Desglose por agente de la cuenta consolidada (15/10/2026, pedido de Leo: "al momento de cargar
// o descargar fichas de un agente impacte... necesito saber las fichas que tiene en momento
// real y eso es lo que va a hacer el saldo real"). El pool de supervisor_cuentas sigue siendo UN
// SOLO número (no se parte de verdad, ver nota arriba de getCuentaParaUpdate/registrarMovimiento
// Supervisor) -- esto es una VISTA calculada aparte que reparte ese mismo número por agente,
// usando el agent_id que ya se graba en cada movimiento/línea de cierre/migración histórica
// (antes el campo era puramente informativo en "Movimientos manuales", ahora también alimenta
// esto). Fichas en tiempo real de un agente = fichas migradas (alta histórica) + suma de
// fichas_reales_delta de sus movimientos APLICADOS + suma de "result" de sus líneas de cierre no
// revertidas. Cuenta corriente = mismo criterio con pendiente_migrado + cuenta_corriente_delta +
// rakeback. Si algún movimiento quedó sin agente (supervisor con exigir_agente_en_movimientos=
// false), se junta aparte en una fila "Sin agente asignado" -- nunca se reparte a ciegas entre
// los agentes -- así el total de esta tabla siempre coincide, centavo a centavo, con
// supervisor_cuentas (misma garantía que ya probamos a mano con Rodrigo antes de armar esto).
export interface SaldoPorClubAgente {
  clubId: string;
  clubName: string;
  fichas: number;
  // fichas = balance (cargas y descargas) + mesas (resultado acumulado de mesas Prepago) -- se separan para la tabla
  // "Fichas por club" de la cuenta de un agente (sección Agentes).
  balance: number;
  mesas: number;
  pendiente: number;
  saldo: number;
}
export interface SaldoPorAgenteSupervisor {
  agentId: string | null;
  agentName: string;
  oculto: boolean;
  fichasTiempoReal: number;
  cuentaCorriente: number;
  saldoReal: number;
  // Desglose por club (15/10/2026, pedido de Leo, caso JereStack en Uriel: "hay forma de ver
  // ambos clubes?") -- OJO, esto es informativo y EN VIVO, no tiene nada que ver con las tres
  // columnas de arriba: es el saldo INDIVIDUAL del agente ahora mismo (balance propio + resultado
  // de mesas + rakeback pendiente activo, mismo cálculo que calcularSaldoActualDeSubordinado,
  // pero partido por club en vez de sumado) -- nunca se suma a la cuenta consolidada, que solo
  // cambia con Carga/Descarga/Ajuste/Cierre semanal. Por eso NO tiene por qué coincidir con
  // fichasTiempoReal/cuentaCorriente/saldoReal de arriba (esos son la foto migrada + movimientos
  // del pool; esto es lo que el agente tiene hoy jugando). Vacío para la fila "Sin agente
  // asignado". Sirve para los casos como JereStack, que juega en más de un club.
  detallePorClub: SaldoPorClubAgente[];
}
export async function listSaldosPorAgenteSupervisor(supervisorAgentId: string): Promise<SaldoPorAgenteSupervisor[]> {
  const cuenta = await agentesDeLaCuenta(supervisorAgentId);
  if (!cuenta) throw new Error("Supervisor no encontrado.");

  const subRes = { rows: cuenta.agentes as { id: string; name: string; oculto_en_supervisor: boolean }[] };
  const migRes = await pool.query(
    `SELECT agent_id, COALESCE(SUM(fichas_migradas), 0) as fichas, COALESCE(SUM(pendiente_migrado), 0) as cc
     FROM supervisor_migracion_historica WHERE supervisor_agent_id = $1 GROUP BY agent_id`,
    [supervisorAgentId]
  );
  const movRes = await pool.query(
    `SELECT agent_id, COALESCE(SUM(fichas_reales_delta), 0) as fichas, COALESCE(SUM(cuenta_corriente_delta), 0) as cc
     FROM supervisor_movimientos WHERE supervisor_agent_id = $1 AND status = 'APLICADO' GROUP BY agent_id`,
    [supervisorAgentId]
  );
  const clRes = await pool.query(
    `SELECT scl.agent_id, COALESCE(SUM(scl.result), 0) as fichas, COALESCE(SUM(scl.rakeback), 0) as cc
     FROM supervisor_cierre_lineas scl JOIN supervisor_cierres sc ON sc.id = scl.cierre_id
     WHERE sc.supervisor_agent_id = $1 AND sc.status <> 'REVERTIDO' GROUP BY scl.agent_id`,
    [supervisorAgentId]
  );

  const SIN_AGENTE = "__sin_agente__";
  const porAgente = new Map<string, { fichas: number; cc: number }>();
  const acumular = (agentId: string | null, fichas: number, cc: number) => {
    const key = agentId ?? SIN_AGENTE;
    const prev = porAgente.get(key) ?? { fichas: 0, cc: 0 };
    porAgente.set(key, { fichas: round2(prev.fichas + fichas), cc: round2(prev.cc + cc) });
  };
  for (const r of migRes.rows) acumular(r.agent_id, Number(r.fichas), Number(r.cc));
  for (const r of movRes.rows) acumular(r.agent_id, Number(r.fichas), Number(r.cc));
  for (const r of clRes.rows) acumular(r.agent_id, Number(r.fichas), Number(r.cc));

  const agentIds = subRes.rows.map((a) => a.id);
  const detallePorAgente = await calcularDetallePorClub(agentIds);

  const filas: SaldoPorAgenteSupervisor[] = subRes.rows.map((a) => {
    const d = porAgente.get(a.id) ?? { fichas: 0, cc: 0 };
    porAgente.delete(a.id);
    return {
      agentId: a.id,
      agentName: a.name,
      oculto: a.oculto_en_supervisor,
      fichasTiempoReal: d.fichas,
      cuentaCorriente: d.cc,
      saldoReal: round2(d.fichas + d.cc),
      detallePorClub: detallePorAgente.get(a.id) ?? [],
    };
  });

  // Lo que quede sin consumir (sin agente, o un agent_id que ya no es subordinado de este
  // supervisor -- ej. se le cambió el campo "Supervisor" después de tener movimientos) se junta
  // en una sola fila para que el total nunca se pierda nada del pool real.
  let sobranteFichas = 0;
  let sobranteCc = 0;
  for (const [, v] of porAgente) {
    sobranteFichas = round2(sobranteFichas + v.fichas);
    sobranteCc = round2(sobranteCc + v.cc);
  }
  if (Math.abs(sobranteFichas) > 0.004 || Math.abs(sobranteCc) > 0.004) {
    filas.push({
      agentId: null,
      agentName: "Sin agente asignado",
      oculto: false,
      fichasTiempoReal: sobranteFichas,
      cuentaCorriente: sobranteCc,
      saldoReal: round2(sobranteFichas + sobranteCc),
      detallePorClub: [],
    });
  }

  return filas;
}

// Saldo individual de cada agente, EN VIVO, partido por club (ver nota en SaldoPorAgenteSupervisor
// de arriba). Mismo cálculo exacto que calcularSaldoActualDeSubordinado (balance + resultado de
// mesas PREPAGO, + rakeback pendiente activo con ABS(amount-consumed) > 0.004), pero agrupado por
// (agente, club) en vez de sumado por agente -- NUNCA toca ni se mezcla con supervisor_cuentas.
async function calcularDetallePorClub(agentIds: string[]): Promise<Map<string, SaldoPorClubAgente[]>> {
  const resultado = new Map<string, Map<string, { clubName: string; fichas: number; balance: number; mesas: number; pendiente: number }>>();
  if (agentIds.length === 0) return new Map();

  const touch = (agentId: string, clubId: string, clubName: string) => {
    let porClub = resultado.get(agentId);
    if (!porClub) {
      porClub = new Map();
      resultado.set(agentId, porClub);
    }
    if (!porClub.has(clubId)) porClub.set(clubId, { clubName, fichas: 0, balance: 0, mesas: 0, pendiente: 0 });
    return porClub.get(clubId)!;
  };

  const balRes = await pool.query(
    `SELECT b.agent_id, b.club_id, c.name as club_name, b.amount
     FROM balances b JOIN clubs c ON c.id = b.club_id
     WHERE b.agent_id = ANY($1) AND b.amount <> 0`,
    [agentIds]
  );
  for (const r of balRes.rows) {
    const e = touch(r.agent_id, r.club_id, r.club_name);
    e.fichas = round2(e.fichas + Number(r.amount));
    e.balance = round2(e.balance + Number(r.amount));
  }

  const mesasRes = await pool.query(
    `SELECT wc.agent_id, wc.club_id, c.name as club_name, COALESCE(SUM(wc.result), 0) as total
     FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE wc.agent_id = ANY($1) AND wc.system = 'PREPAGO' AND wc.status <> 'REVERTIDO'
     GROUP BY wc.agent_id, wc.club_id, c.name`,
    [agentIds]
  );
  for (const r of mesasRes.rows) {
    const e = touch(r.agent_id, r.club_id, r.club_name);
    e.fichas = round2(e.fichas + Number(r.total));
    e.mesas = round2(e.mesas + Number(r.total));
  }

  const pendRes = await pool.query(
    `SELECT rp.agent_id, rp.club_id, c.name as club_name, rp.amount, rp.consumed
     FROM rakeback_pendiente rp JOIN clubs c ON c.id = rp.club_id
     WHERE rp.agent_id = ANY($1) AND rp.active = true`,
    [agentIds]
  );
  for (const r of pendRes.rows) {
    const diff = Number(r.amount) - Number(r.consumed);
    if (Math.abs(diff) <= 0.004) continue;
    const e = touch(r.agent_id, r.club_id, r.club_name);
    e.pendiente = round2(e.pendiente + diff);
  }

  const final = new Map<string, SaldoPorClubAgente[]>();
  for (const [agentId, porClub] of resultado) {
    const filas: SaldoPorClubAgente[] = [];
    for (const [clubId, v] of porClub) {
      if (Math.abs(v.fichas) <= 0.004 && Math.abs(v.pendiente) <= 0.004) continue;
      filas.push({ clubId, clubName: v.clubName, fichas: v.fichas, balance: v.balance, mesas: v.mesas, pendiente: v.pendiente, saldo: round2(v.fichas + v.pendiente) });
    }
    filas.sort((a, b) => a.clubName.localeCompare(b.clubName));
    if (filas.length > 0) final.set(agentId, filas);
  }
  return final;
}

export async function listMigracionHistorica(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT smh.*, a.name as agent_name, c.name as club_name
     FROM supervisor_migracion_historica smh
     JOIN agents a ON a.id = smh.agent_id
     LEFT JOIN clubs c ON c.id = smh.club_id
     WHERE smh.supervisor_agent_id = $1
     ORDER BY smh.created_at`,
    [supervisorAgentId]
  );
  return r.rows;
}

// ---------------------------------------------------------------------------------------------
// Importar saldos de los agentes a cargo (20/10/2026, pedido de Leo: "un botón dentro de supervisor para mover los
// saldos" al crear un supervisor y asignarle agentes). Generaliza los scripts migrarSaldoHistorico*/ajustarSaldoInicial*:
//  - Prepago: fichas = balance + resultado de mesas PREPAGO; cuenta corriente = rakeback pendiente activo (igual que
//    calcularSaldoActualDeSubordinado).
//  - Win/Lose: solo cuenta corriente = saldo operativo final de "Resumen por agente" de la última semana con cierre
//    (negativo = el agente nos debe).
// Queda registrado como una línea de supervisor_migracion_historica ("Origen del saldo") con la semana de corte: los
// cierres de esa semana y anteriores YA están dentro del saldo y el cierre consolidado no los vuelve a sumar.
// Nunca toca balances/pendientes/liquidaciones del agente. Un agente ya importado no se vuelve a importar.
// ---------------------------------------------------------------------------------------------
export type EstadoImportacionAgente = "NUEVO" | "IMPORTADO" | "OPERA_EN_CUENTA";
export interface PropuestaImportacionAgente {
  agentId: string;
  agentName: string;
  estado: EstadoImportacionAgente;
  fichas: number;
  cuentaCorriente: number;
  clubId: string | null;
  semanaCorte: string | null;
  importado: { fichas: number; cuentaCorriente: number; fecha: string } | null;
  motivo: string | null;
}

async function calcularPropuestaImportacion(sup: any, ag: any): Promise<PropuestaImportacionAgente> {
  const winLose = esSupervisorWinLose(sup);
  const ult = await pool.query(
    `SELECT week_start, club_id FROM weekly_closings WHERE agent_id = $1 AND status <> 'REVERTIDO' ORDER BY week_start DESC, created_at DESC LIMIT 1`,
    [ag.id]
  );
  const semanaCorte: string | null = ult.rows[0] ? String(ult.rows[0].week_start).slice(0, 10) : null;

  let fichas = 0;
  let cuentaCorriente = 0;
  let clubId: string | null = ult.rows[0]?.club_id ?? null;
  if (winLose) {
    if (semanaCorte) {
      const r = await getResumenAgentePDF(ag.id, semanaCorte, "WIN_LOSE");
      cuentaCorriente = r ? round2(r.estadoCuenta.saldoOperativoFinal) : 0;
    }
  } else {
    const saldo = await calcularSaldoActualDeSubordinado(ag.id);
    fichas = saldo.fichas;
    cuentaCorriente = saldo.pendiente;
    clubId = clubId ?? saldo.clubId;
  }

  const imp = await pool.query(
    `SELECT COALESCE(SUM(fichas_migradas),0) as f, COALESCE(SUM(pendiente_migrado),0) as p, MAX(created_at) as fecha, COUNT(*) as n
     FROM supervisor_migracion_historica WHERE supervisor_agent_id = $1 AND agent_id = $2`,
    [sup.id, ag.id]
  );
  if (Number(imp.rows[0].n) > 0) {
    return {
      agentId: ag.id, agentName: ag.name, estado: "IMPORTADO", fichas, cuentaCorriente, clubId, semanaCorte,
      importado: { fichas: round2(Number(imp.rows[0].f)), cuentaCorriente: round2(Number(imp.rows[0].p)), fecha: new Date(imp.rows[0].fecha).toISOString() },
      motivo: null,
    };
  }

  const opera = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM supervisor_cierre_lineas l JOIN supervisor_cierres c ON c.id = l.cierre_id
         WHERE c.supervisor_agent_id = $1 AND l.agent_id = $2 AND c.status <> 'REVERTIDO') as cierres,
       (SELECT COUNT(*) FROM supervisor_movimientos m
         WHERE m.supervisor_agent_id = $1 AND m.agent_id = $2 AND m.status <> 'REVERTIDO') as movs`,
    [sup.id, ag.id]
  );
  const cierres = Number(opera.rows[0].cierres);
  const movs = Number(opera.rows[0].movs);
  if (cierres > 0 || movs > 0) {
    return {
      agentId: ag.id, agentName: ag.name, estado: "OPERA_EN_CUENTA", fichas, cuentaCorriente, clubId, semanaCorte, importado: null,
      motivo: `Ya tiene ${cierres} cierre${cierres === 1 ? "" : "s"} y ${movs} movimiento${movs === 1 ? "" : "s"} en la cuenta: importar su saldo lo duplicaría.`,
    };
  }
  return { agentId: ag.id, agentName: ag.name, estado: "NUEVO", fichas, cuentaCorriente, clubId, semanaCorte, importado: null, motivo: null };
}

export async function previsualizarImportacionSaldos(supervisorAgentId: string): Promise<PropuestaImportacionAgente[]> {
  const supRes = await pool.query(`SELECT * FROM agents WHERE id = $1`, [supervisorAgentId]);
  const sup = supRes.rows[0];
  if (!sup) throw new Error("Supervisor no encontrado.");
  if (!sup.usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");
  const cuenta = await agentesDeLaCuenta(supervisorAgentId);
  const ags = (cuenta?.agentes ?? []).filter((a: any) => a.active && !a.oculto_en_supervisor);
  const out: PropuestaImportacionAgente[] = [];
  for (const ag of ags) out.push(await calcularPropuestaImportacion(sup, ag));
  return out;
}

export async function importarSaldosSupervisor(supervisorAgentId: string, agentIds: string[], createdBy?: string | null) {
  if (agentIds.length === 0) throw new Error("Elegí al menos un agente para importar.");
  const supRes = await pool.query(`SELECT * FROM agents WHERE id = $1`, [supervisorAgentId]);
  const sup = supRes.rows[0];
  if (!sup) throw new Error("Supervisor no encontrado.");
  if (!sup.usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");

  const propuestas = (await previsualizarImportacionSaldos(supervisorAgentId)).filter((p) => agentIds.includes(p.agentId));
  if (propuestas.length !== new Set(agentIds).size) throw new Error("Algún agente no está a cargo de este supervisor.");
  for (const p of propuestas) {
    if (p.estado === "IMPORTADO") throw new Error(`"${p.agentName}" ya tiene su saldo importado.`);
    if (p.estado === "OPERA_EN_CUENTA") throw new Error(`"${p.agentName}": ${p.motivo}`);
  }
  const clubFallback: string | null = (await pool.query(`SELECT id FROM clubs ORDER BY name LIMIT 1`)).rows[0]?.id ?? null;
  const winLose = esSupervisorWinLose(sup);
  const lineas: LineaMigracionHistorica[] = propuestas.map((p) => ({
    agentId: p.agentId,
    clubId: p.clubId ?? clubFallback,
    fichasMigradas: p.fichas,
    pendienteMigrado: p.cuentaCorriente,
    semanaCorte: p.semanaCorte,
    notes: winLose
      ? `Saldo importado de "${p.agentName}" según Resumen por agente${p.semanaCorte ? ` (semana ${p.semanaCorte})` : ""}.`
      : `Saldo importado de "${p.agentName}": fichas (balance + mesas Prepago) y rakeback pendiente actuales.`,
  }));
  const r = await migrarSaldoHistoricoSupervisor(supervisorAgentId, lineas, createdBy ?? null);
  return { importados: propuestas.length, ...r };
}

// ---------------------------------------------------------------------------------------------
// Cierre semanal consolidado (14/10/2026, pedido de Leo: "las liquidaciones de sus agentes, sumen
// su saldo al momento de hacer el cierre" -- confirmado con él: el saldo PROPIO del agente sigue
// acumulando exactamente igual que siempre (balances/rakeback_pendiente, sin tocar), esto es un
// espejo automático aparte, mismo criterio que ya usa "Carga/Descarga/Ajuste" manual. Reusa las
// tablas supervisor_cierres/supervisor_cierre_lineas, que ya estaban en el schema (pensadas para
// esto) pero sin ningún código que las usara todavía.
//
// Fichas ganadas en la semana (weekly_closings.result, el resultado de mesas) -> fichas_reales.
// Rakeback generado en la semana (weekly_closings.rakeback) -> cuenta_corriente.
// NUNCA el rebate (es un campo distinto, del mecanismo viejo rebate_destino=RAKEBACK_SUPERVISOR,
// que convive aparte y no hay que mezclar acá).
// ---------------------------------------------------------------------------------------------

// Cierres que NO se vuelven a sumar (20/10/2026): los de un agente cuyo saldo ya fue importado con el botón "Importar
// saldos" y cuya semana es igual o anterior a la semana de corte de esa importación -- ya están dentro del saldo.
const noImportadoSql = (supParam: string) =>
  `NOT EXISTS (SELECT 1 FROM supervisor_migracion_historica smh
     WHERE smh.supervisor_agent_id = ${supParam} AND smh.agent_id = wc.agent_id
       AND smh.semana_corte IS NOT NULL AND smh.semana_corte >= wc.week_start)`;

export async function getSemanasDisponiblesSupervisor(supervisorAgentId: string) {
  const cuenta = await agentesDeLaCuenta(supervisorAgentId);
  if (!cuenta) return [];
  const r = await pool.query(
    `SELECT DISTINCT wc.week_start, wc.week_end
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     WHERE a.id = ANY($1::text[]) AND wc.status <> 'REVERTIDO'
     ORDER BY wc.week_start DESC LIMIT 52`,
    [cuenta.ids]
  );
  return r.rows;
}

export async function getCierreSemanalSupervisor(supervisorAgentId: string, weekStart: string) {
  const sup = await pool.query(`SELECT name, default_system FROM agents WHERE id = $1`, [supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  const winLose = esSupervisorWinLose(sup.rows[0]);
  const cuentaIds = (await agentesDeLaCuenta(supervisorAgentId))!.ids;

  // rebate / rodeo / total (20/10/2026, supervisor Win/Lose): el total de cada agente es su cierre COMPLETO
  // (weekly_closings.final_closing = resultado + rakeback + rebate + rodeo + ajuste manual), que es lo que se suma
  // a la cuenta corriente de un supervisor Win/Lose. En Prepago estas columnas son informativas.
  const lineas = await pool.query(
    `SELECT a.id as agent_id, a.name as agent_name,
            COALESCE(SUM(wc.result), 0) as result,
            COALESCE(SUM(wc.rakeback), 0) as rakeback,
            COALESCE(SUM(wc.rebate), 0) as rebate,
            COALESCE(SUM(wc.rodeo), 0) as rodeo,
            COALESCE(SUM(wc.final_closing), 0) as total
     FROM agents a
     LEFT JOIN weekly_closings wc
       ON wc.agent_id = a.id AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO' AND ${noImportadoSql("$3")}
     WHERE a.id = ANY($1::text[])
     GROUP BY a.id, a.name
     ORDER BY a.name`,
    [cuentaIds, weekStart, supervisorAgentId]
  );

  // Agentes con cierre cargado esa semana que NO se suma porque ya está dentro de su saldo importado.
  const yaIncluidos = await pool.query(
    `SELECT DISTINCT a.name FROM weekly_closings wc JOIN agents a ON a.id = wc.agent_id
     WHERE a.id = ANY($1::text[]) AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO' AND NOT ${noImportadoSql("$3")}
     ORDER BY a.name`,
    [cuentaIds, weekStart, supervisorAgentId]
  );

  // Desglose por club de cada agente (19/10/2026, pedido de Leo: que el supervisor pueda desplegar de dónde sale
  // el cierre de cada agente) -- una fila por weekly_closing real de esa semana, solo lectura, nunca recalcula nada.
  const detalle = await pool.query(
    `SELECT wc.agent_id, c.name as club_name, wc.system, wc.jugadores, wc.result, wc.rake_total, wc.rakeback_pct, wc.rakeback,
            wc.rebate, wc.rodeo, wc.final_closing
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     WHERE a.id = ANY($1::text[]) AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO' AND ${noImportadoSql("$3")}
     ORDER BY c.name`,
    [cuentaIds, weekStart, supervisorAgentId]
  );
  const detallePorAgente = new Map<string, any[]>();
  for (const d of detalle.rows) {
    const arr = detallePorAgente.get(d.agent_id) ?? [];
    arr.push({
      club_name: d.club_name,
      system: d.system,
      jugadores: d.jugadores,
      result: Number(d.result),
      rake_total: Number(d.rake_total),
      rakeback_pct: Number(d.rakeback_pct),
      rakeback: Number(d.rakeback),
      rebate: Number(d.rebate),
      rodeo: Number(d.rodeo),
      total: Number(d.final_closing),
    });
    detallePorAgente.set(d.agent_id, arr);
  }

  const aplicado = await pool.query(
    `SELECT * FROM supervisor_cierres WHERE supervisor_agent_id = $1 AND week_start = $2::date AND status <> 'REVERTIDO'`,
    [supervisorAgentId, weekStart]
  );

  const resultadoTotal = round2(lineas.rows.reduce((s, l) => s + Number(l.result), 0));
  const rakebackTotal = round2(lineas.rows.reduce((s, l) => s + Number(l.rakeback), 0));
  const totalCierre = round2(lineas.rows.reduce((s, l) => s + Number(l.total), 0));

  return {
    sistema: winLose ? "WIN_LOSE" : "PREPAGO",
    lineas: lineas.rows.map((l) => ({ ...l, detalle: detallePorAgente.get(l.agent_id) ?? [] })),
    resultadoTotal,
    rakebackTotal,
    // Lo que de verdad se suma a la cuenta corriente al aplicar: en Win/Lose el cierre completo; en Prepago solo
    // el rakeback (el resultado va a fichas reales).
    totalCierre,
    efectoCuentaCorriente: winLose ? totalCierre : rakebackTotal,
    agentesYaIncluidosEnSaldo: yaIncluidos.rows.map((r) => r.name as string),
    aplicado: aplicado.rows[0] ?? null,
  };
}

// Aplica el cierre de la semana a la cuenta: suma resultadoTotal a fichas_reales y rakebackTotal a
// cuenta_corriente, dejando el desglose por agente+club en supervisor_cierre_lineas. Idempotente:
// el UNIQUE(supervisor_agent_id, week_start) de supervisor_cierres impide aplicar la misma semana
// dos veces -- tira error claro en vez de sumar de nuevo.
export async function aplicarCierreConsolidadoSupervisor(
  supervisorAgentId: string,
  weekStart: string,
  weekEnd: string,
  createdBy?: string | null
) {
  const sup = await pool.query(`SELECT * FROM agents WHERE id = $1`, [supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  if (!sup.rows[0].usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");
  if (!sup.rows[0].consolidar_cierres) {
    throw new Error("Este supervisor tiene desactivada la consolidación automática de cierres.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const yaAplicado = await client.query(
      `SELECT id FROM supervisor_cierres WHERE supervisor_agent_id = $1 AND week_start = $2::date AND status <> 'REVERTIDO' FOR UPDATE`,
      [supervisorAgentId, weekStart]
    );
    if (yaAplicado.rows[0]) throw new Error("Esta semana ya fue aplicada a la cuenta de este supervisor.");

    const lineasRes = await client.query(
      `SELECT wc.id as weekly_closing_id, wc.agent_id, wc.club_id,
              wc.result, wc.rake_total, wc.rakeback_pct, wc.rakeback, wc.rebate_pct, wc.rebate, wc.final_closing
       FROM weekly_closings wc
       JOIN agents a ON a.id = wc.agent_id
       WHERE a.id = ANY($1::text[]) AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO' AND ${noImportadoSql("$3")}`,
      [(await agentesDeLaCuenta(supervisorAgentId))!.ids, weekStart, supervisorAgentId]
    );
    if (lineasRes.rows.length === 0) {
      throw new Error("No hay ningún cierre para sumar en esa semana (si hay cierres cargados, ya están incluidos en el saldo importado de sus agentes).");
    }

    const resultadoTotal = round2(lineasRes.rows.reduce((s, l) => s + Number(l.result), 0));
    const rakebackTotal = round2(lineasRes.rows.reduce((s, l) => s + Number(l.rakeback), 0));
    const rakeTotal = round2(lineasRes.rows.reduce((s, l) => s + Number(l.rake_total), 0));
    const rebateTotal = round2(lineasRes.rows.reduce((s, l) => s + Number(l.rebate), 0));

    // Supervisor WIN/LOSE (20/10/2026): el cierre COMPLETO de cada agente (final_closing) va a cuenta corriente y
    // fichas_reales no se mueve. Para que revertir (que resta resultado_total de fichas y rakeback_total de cuenta
    // corriente) y la vista "Origen del saldo" (que suma result a fichas y rakeback a cuenta corriente) sigan
    // funcionando SIN tocarse, en Win/Lose se guarda: resultado_total/result = 0 y rakeback_total/rakeback = el cierre
    // completo. El desglose real (resultado, rakeback, rebate) se sigue viendo uniendo con weekly_closing_origen_id.
    const winLose = esSupervisorWinLose(sup.rows[0]);
    const totalCierre = round2(lineasRes.rows.reduce((s, l) => s + Number(l.final_closing), 0));
    const deltaFichas = winLose ? 0 : resultadoTotal;
    const deltaCc = winLose ? totalCierre : rakebackTotal;

    const cuenta = await getCuentaParaUpdate(client, supervisorAgentId);
    const fichasAntes = Number(cuenta.fichas_reales);
    const ccAntes = Number(cuenta.cuenta_corriente);
    const fichasDespues = round2(fichasAntes + deltaFichas);
    const ccDespues = round2(ccAntes + deltaCc);

    const cierreId = newId("svcierre");
    await client.query(
      `INSERT INTO supervisor_cierres
        (id, supervisor_agent_id, week_start, week_end, resultado_total, rake_total, rakeback_total, rebate_total,
         fichas_reales_antes, cuenta_corriente_antes, fichas_reales_despues, cuenta_corriente_despues, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        cierreId, supervisorAgentId, weekStart, weekEnd, deltaFichas, rakeTotal, deltaCc, rebateTotal,
        fichasAntes, ccAntes, fichasDespues, ccDespues, createdBy ?? null,
      ]
    );

    for (const l of lineasRes.rows) {
      await client.query(
        `INSERT INTO supervisor_cierre_lineas
          (id, cierre_id, agent_id, club_id, result, rake_total, rakeback_pct, rakeback, rebate_pct, rebate, weekly_closing_origen_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          newId("svcl"), cierreId, l.agent_id, l.club_id, winLose ? 0 : l.result, l.rake_total, l.rakeback_pct,
          winLose ? l.final_closing : l.rakeback, l.rebate_pct, l.rebate, l.weekly_closing_id,
        ]
      );
    }

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasDespues, ccDespues, cuenta.id]
    );

    await client.query("COMMIT");
    return { cierreId, resultadoTotal: deltaFichas, rakebackTotal: deltaCc, totalCierre, winLose, fichasAntes, ccAntes, fichasDespues, ccDespues };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Revierte un cierre consolidado aplicado por error (15/10/2026, pedido de Leo) -- LEDGER
// INMUTABLE, no se borra la fila: resta de la cuenta exactamente lo que ese cierre había sumado
// (resultado_total de fichas_reales, rakeback_total de cuenta_corriente) y marca REVERTIDO.
// A diferencia de la memoria de bancados/rodeo (un valor corrido que depende del orden en que
// se revierte), fichas_reales/cuenta_corriente son una simple suma acumulada de deltas
// independientes entre sí -- restar el delta de ESTE cierre lo deja correcto sin importar qué
// otros movimientos/cierres se hayan aplicado antes o después, no hace falta revertir en orden
// cronológico inverso. Deja la semana libre para volver a aplicarla (índice único parcial en
// schema.sql que ignora los REVERTIDO, mismo criterio que proveedor_cierres) -- NO borra ni
// toca supervisor_cierre_lineas, que queda como rastro histórico de lo que decía ese cierre.
export async function revertirCierreConsolidadoSupervisor(cierreId: string, motivo?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cierreRes = await client.query(`SELECT * FROM supervisor_cierres WHERE id = $1 FOR UPDATE`, [cierreId]);
    const cierre = cierreRes.rows[0];
    if (!cierre) throw new Error("Cierre no encontrado.");
    if (cierre.status === "REVERTIDO") {
      throw new Error("Este cierre ya fue revertido antes -- no se puede revertir dos veces.");
    }

    const cuenta = await getCuentaParaUpdate(client, cierre.supervisor_agent_id);
    const fichasAnterior = Number(cuenta.fichas_reales);
    const ccAnterior = Number(cuenta.cuenta_corriente);
    const fichasNuevo = round2(fichasAnterior - Number(cierre.resultado_total));
    const ccNuevo = round2(ccAnterior - Number(cierre.rakeback_total));

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasNuevo, ccNuevo, cuenta.id]
    );
    await client.query(
      `UPDATE supervisor_cierres SET status = 'REVERTIDO', motivo_reversion = $2 WHERE id = $1`,
      [cierreId, motivo ?? null]
    );
    await client.query("COMMIT");
    return { id: cierreId, fichasAnterior, ccAnterior, fichasNuevo, ccNuevo };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}


// =================================================================================================
// Solicitudes de retiro/pago de un Supervisor (16/10/2026, pedido de Leo: "al supervisor le
// queremos poner botones para que pueda solicitar retiros/pagos y que nos llegue la notificacion
// a nosotros... al momento de enviarlos en el historial queremos dejar el link de pago para que
// el pueda ver el trackeo"). Es SOLO el "pedido" y su estado -- ninguna plata se mueve acá. El
// movimiento real sigue siendo el de siempre (registrarMovimientoSupervisor, DESCARGA +
// usdtReal=true), disparado recién cuando el admin la marca como enviada (ver
// marcarSolicitudRetiroEnviada). Ver repo/alertas.ts para cómo le llega la notificación al
// admin (misma campana del sistema, un tipo de alerta más).
// =================================================================================================

export async function crearSolicitudRetiroSupervisor(
  supervisorAgentId: string,
  amount: number,
  nota: string | null,
  createdBy?: string | null
) {
  const sup = await pool.query(`SELECT id, usa_cuenta_consolidada FROM agents WHERE id = $1`, [supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  if (!sup.rows[0].usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("El monto debe ser mayor a 0.");

  const id = newId("svsol");
  const r = await pool.query(
    `INSERT INTO supervisor_solicitudes_retiro (id, supervisor_agent_id, amount, nota, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, supervisorAgentId, round2(amount), nota, createdBy ?? null]
  );
  return r.rows[0];
}

export async function listSolicitudesRetiroSupervisor(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT * FROM supervisor_solicitudes_retiro WHERE supervisor_agent_id = $1 ORDER BY requested_at DESC`,
    [supervisorAgentId]
  );
  return r.rows;
}

// Lado admin: todas las pendientes, de cualquier supervisor -- para el panel en Administración
// -> Supervisores y para la campana de notificaciones (repo/alertas.ts).
export async function listSolicitudesRetiroPendientesTodas() {
  const r = await pool.query(
    `SELECT sr.*, a.name as supervisor_name, a.exigir_agente_en_movimientos, a.default_system as supervisor_default_system
     FROM supervisor_solicitudes_retiro sr
     JOIN agents a ON a.id = sr.supervisor_agent_id
     WHERE sr.estado = 'PENDIENTE'
     ORDER BY sr.requested_at ASC`
  );
  return r.rows;
}

// El admin ya mandó los USDT de verdad: esto crea la Descarga de siempre (ledger inmutable,
// usdtReal=true -- mueve Wallet Manos igual que cualquier otra) con el link de pago adentro, y
// deja la solicitud marcada ENVIADO apuntando a ese movimiento. No es atómico entre las dos
// tablas (mismo criterio ya usado en el resto del sistema para acciones que cruzan subsistemas,
// ver nota larga en registrarMovimientoSupervisor) -- si la segunda parte fallara, el movimiento
// ya quedó registrado y auditable, se puede enlazar a mano.
export async function marcarSolicitudRetiroEnviada(
  solicitudId: string,
  input: { clubId?: string | null; agentId?: string | null; paymentLink: string; createdBy?: string | null }
) {
  const sol = await pool.query(`SELECT * FROM supervisor_solicitudes_retiro WHERE id = $1`, [solicitudId]);
  const solicitud = sol.rows[0];
  if (!solicitud) throw new Error("Solicitud no encontrada.");
  if (solicitud.estado !== "PENDIENTE") throw new Error("Esta solicitud ya fue resuelta.");
  if (!input.paymentLink?.trim()) throw new Error("Falta el link de pago.");

  // Supervisor Win/Lose (20/10/2026): no tiene fichas ni Descarga -- el retiro se asienta como un PAGO en USDT contra
  // su cuenta corriente (sin club), igual que "Pagar" en Supervisores.
  const supSol = await pool.query(`SELECT default_system FROM agents WHERE id = $1`, [solicitud.supervisor_agent_id]);
  const esWL = esSupervisorWinLose(supSol.rows[0]);
  if (!esWL && !input.clubId) throw new Error("Falta elegir el club.");
  const movimiento = await registrarMovimientoSupervisor({
    supervisorAgentId: solicitud.supervisor_agent_id,
    clubId: esWL ? null : input.clubId,
    agentId: input.agentId ?? null,
    type: esWL ? "PAGO" : "DESCARGA",
    amount: Number(solicitud.amount),
    usdtReal: true,
    notes: solicitud.nota ? `Solicitud de retiro del supervisor — ${solicitud.nota}` : "Solicitud de retiro del supervisor.",
    paymentLink: input.paymentLink.trim(),
    createdBy: input.createdBy ?? null,
  });

  const r = await pool.query(
    `UPDATE supervisor_solicitudes_retiro
     SET estado = 'ENVIADO', payment_link = $1, movimiento_id = $2, resuelto_at = now(), resuelto_by = $3
     WHERE id = $4 RETURNING *`,
    [input.paymentLink.trim(), movimiento.id, input.createdBy ?? null, solicitudId]
  );
  return r.rows[0];
}

export async function rechazarSolicitudRetiro(solicitudId: string, motivo: string | null, resueltoBy?: string | null) {
  const r = await pool.query(
    `UPDATE supervisor_solicitudes_retiro
     SET estado = 'RECHAZADO', resolucion_nota = $1, resuelto_at = now(), resuelto_by = $2
     WHERE id = $3 AND estado = 'PENDIENTE' RETURNING *`,
    [motivo, resueltoBy ?? null, solicitudId]
  );
  if (!r.rows[0]) throw new Error("Solicitud no encontrada o ya resuelta.");
  return r.rows[0];
}
