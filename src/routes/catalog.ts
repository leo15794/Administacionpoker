import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  upsertAgent,
  upsertClub,
  upsertDeal,
  updateAgent,
  updateClubConfig,
  listAgents,
  listClubs,
  listDealsForAgent,
  addRuleVersion,
  endRuleVersion,
  listRulesForAgent,
  listAllRules,
  getArbolClubes,
  getJugadoresDeAgenteEnClub,
  getJugadoresDeAgente,
  eliminarJugador,
  resolverConfigVigente,
  moverAgenteDeClub,
  eliminarAgenteDefinitivo,
  listAllDeals,
  listJugadoresBancados,
  buscarJugadores,
  setJugadorBancado,
  setSubagenteJugador,
} from "../repo/catalog.js";
import { listBalancesByAgent, listMovementsByAgent, eliminarMovimiento as eliminarMovimientoLedger } from "../repo/ledger.js";
import { listCargasPendientesPorAgentes, consumirCarga, eliminarCarga, eliminarMovimientoCarga } from "../repo/cargaCruces.js";
import { eliminarMovimientoAdelanto } from "../repo/advances.js";
import { revertirPagoPendiente } from "../repo/rakebackPendiente.js";
import { pool, newId } from "../db/pool.js";

const ACCOUNT_TYPES = ["PREPAGO", "WIN_LOSE", "BANCADO", "INTERNO", "SUPERVISOR", "UNION"] as const;
// Catálogo cerrado de reglas especiales que el motor de cierre sabe interpretar (ver
// resolverSpecialRule en repo/closings.ts). Agregar una regla nueva a este catálogo requiere
// código (la fórmula en sí), pero asignarla a un agente y cambiar sus parámetros NUNCA — eso
// es justamente lo que este módulo saca del código y pone en la base, versionado.
const RULE_KEYS = ["MANZUR_75_RAKE"] as const;

export const catalogRouter = Router();

// Listados (para llenar selects en el frontend)
catalogRouter.get("/clubs", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listClubs());
});

catalogRouter.get("/agents", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listAgents(req.query.includeInactive === "true"));
});

// Alta / edición de club (upsert por nombre)
const clubSchema = z.object({
  name: z.string().min(2),
  unit: z.enum(["USD", "USDT", "FICHAS"]).default("USD"),
  currentRate: z.number().positive().default(1),
});
catalogRouter.post("/clubs", requireAuth, requireAdmin, async (req, res) => {
  const parsed = clubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const club = await upsertClub(parsed.data.name, parsed.data.unit, parsed.data.currentRate);
    res.status(201).json(club);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Alta / edición de agente (upsert por nombre)
const agentSchema = z.object({
  name: z.string().min(2),
  defaultSystem: z.enum(["PREPAGO", "WIN_LOSE"]),
  supervisor: z.string().optional(),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
});
catalogRouter.post("/agents", requireAuth, requireAdmin, async (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const agent = await upsertAgent(parsed.data.name, parsed.data.defaultSystem, parsed.data.supervisor ?? null, parsed.data.accountType);
    res.status(201).json(agent);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Configuración por defecto de un club ya creado (punto 8: rakeback/rebate/fee que heredan
// los deals agente↔club que no definan el suyo propio).
const clubConfigSchema = z.object({
  name: z.string().min(2).optional(),
  unit: z.enum(["USD", "USDT", "FICHAS"]).optional(),
  currentRate: z.number().positive().optional(),
  defaultRakebackPct: z.number().min(0).max(1).optional(),
  // El rebate puede ser negativo (ej. TeamBack GG: -10%, se RESTA del resultado+rake — ver
  // engine/cierre.ts) — antes esto estaba acotado a [0,1] igual que rakeback, lo que hacía
  // imposible cargar un rebate negativo desde la UI y forzaba a cargarlo con el signo al revés.
  defaultRebatePct: z.number().min(-1).max(1).optional(),
  rebateDestino: z.enum(["SALDO_OPERATIVO", "RAKEBACK_SUPERVISOR"]).optional(),
  feePct: z.number().min(0).max(1).optional(),
  platformPct: z.number().min(0).max(1).optional(),
  unionPct: z.number().min(0).max(1).optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  // Nombre de hoja (.xlsx) que usa este club en el archivo semanal — ej. "Fenix", "tb".
  // Es solo una sugerencia para precargar el selector del importador, nunca un requisito.
  importSource: z.string().nullable().optional(),
  // Plataforma/red de origen para el importador (ej. "SUPREMA") — determina en qué selector
  // de club aparece este club al importar un archivo de esa plataforma.
  importPlatform: z.string().nullable().optional(),
});
catalogRouter.patch("/clubs/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = clubConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const club = await updateClubConfig(req.params.id, parsed.data);
    if (!club) return res.status(404).json({ error: "Club no encontrado" });
    res.json(club);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Alta / edición de deal agente↔club (versiona el deal anterior, no lo pisa)
const dealSchema = z.object({
  agentId: z.string(),
  clubId: z.string(),
  system: z.enum(["PREPAGO", "WIN_LOSE"]),
  rakebackPct: z.number().min(0).max(1),
  // Mismo motivo que en clubConfigSchema.defaultRebatePct: un rebate negativo (ej. -10% en
  // TeamBack GG) es un caso real y válido, no un error de carga.
  rebatePct: z.number().min(-1).max(1).default(0),
  notes: z.string().optional(),
  // Vigente desde (YYYY-MM-DD), opcional -- sin esto el deal rige desde ahora, igual que siempre.
  validFrom: z.string().optional(),
});
// Todos los deals vigentes de todos los agentes, para pintar el % en la lista principal de
// agentes de un vistazo (ver quién tiene deal propio y quién todavía no) sin pedir uno por uno.
catalogRouter.get("/deals", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAllDeals());
});

catalogRouter.post("/deals", requireAuth, requireAdmin, async (req, res) => {
  const parsed = dealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const id = await upsertDeal(
      parsed.data.agentId,
      parsed.data.clubId,
      parsed.data.system,
      parsed.data.rakebackPct,
      parsed.data.rebatePct,
      parsed.data.notes,
      parsed.data.validFrom
    );
    res.status(201).json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

catalogRouter.get("/agents/:id/deals", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listDealsForAgent(req.params.id));
});

// Estado de cuenta completo de un agente (mismo shape que /portal/mi-cuenta, pero para que un
// admin lo vea de CUALQUIER agente): saldo por club, garantía vigente, últimos cierres y
// movimientos recientes, todo en una sola vista en vez de solo la lista cruda de movimientos.
catalogRouter.get("/agents/:id/cuenta", requireAuth, requireAdmin, async (req, res) => {
  const agentId = req.params.id;
  const agent = await pool.query(`SELECT id, name, default_system, supervisor FROM agents WHERE id = $1`, [agentId]);
  if (agent.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });

  const balances = await listBalancesByAgent(agentId);
  const movimientos = await listMovementsByAgent(agentId, 100);
  const guarantee = await pool.query(`SELECT * FROM guarantees WHERE agent_id = $1 AND active = true`, [agentId]);
  const closings = await pool.query(
    `SELECT wc.*, c.name as club_name FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE agent_id = $1 ORDER BY week_start DESC LIMIT 60`,
    [agentId]
  );
  // Stock físico por cuenta (mismo dato que "Stock y deudas" -> Stock por cuenta), para que la
  // ficha del agente en Administración no obligue a ir a otra pantalla a ver esto.
  const stock = await pool.query(
    `SELECT s.*, c.name as club_name,
            CASE WHEN s.rate IS NOT NULL THEN s.units * s.rate ELSE NULL END as usd_ref
     FROM account_stock s JOIN clubs c ON c.id = s.club_id
     WHERE s.agent_id = $1 ORDER BY c.name`,
    [agentId]
  );
  // kind='RAKEBACK' (01/10/2026, caso cajerouy -- la ficha mostraba "Adelantos pendientes:
  // US$ 1.240,00" para un agente cuyo saldo ya reflejaba esa deuda): un adelanto
  // kind='FICHAS_PENDIENTE' YA está restado de balances.amount en el momento en que se dio (ver
  // deltaParaBalance en repo/ledger.ts) -- mostrarlo acá de nuevo como "pendiente" aparte lo
  // contaba dos veces. Mismo criterio que ya usa Resumen por Agente -> Saldos actuales
  // (repo/agentesResumen.ts) y getAdelantoRakebackEnFechas (repo/advances.ts).
  const adelantos = await pool.query(
    `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true AND kind = 'RAKEBACK' ORDER BY created_at DESC`,
    [agentId]
  );

  res.json({
    agente: agent.rows[0],
    saldos: balances,
    movimientos,
    garantia: guarantee.rows[0] ?? null,
    cierres: closings.rows,
    stock: stock.rows,
    adelantos: adelantos.rows,
  });
});

// Semanas con cierres cargados para uno o varios agentes (para el selector de la liquidación,
// que ahora permite combinar varios agentes/clubes en un solo PDF — ej. "Prodigio" cuando en
// realidad son varias identidades de agente, una por club). ?agentIds=a,b,c (unión de semanas
// de todos) — más reciente primero.
catalogRouter.get("/liquidacion/semanas", requireAuth, requireAdmin, async (req, res) => {
  const agentIds = String(req.query.agentIds || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (agentIds.length === 0) return res.status(400).json({ error: "Falta agentIds" });
  // system (30/09/2026, pedido de Leo -- separar los motores WIN_LOSE/PREPAGO para que no se
  // pisen): opcional, filtra las semanas a las que tengan al menos un cierre de ese sistema.
  const system = req.query.system === "WIN_LOSE" || req.query.system === "PREPAGO" ? String(req.query.system) : null;
  const r = await pool.query(
    `SELECT DISTINCT week_start, week_end FROM weekly_closings
     WHERE agent_id = ANY($1::text[]) AND status <> 'REVERTIDO' ${system ? "AND system = $2" : ""}
     ORDER BY week_start DESC LIMIT 52`,
    system ? [agentIds, system] : [agentIds]
  );
  res.json(r.rows);
});

// Resumen de liquidación de UNA semana, combinando uno o varios agentes (de clubes distintos si
// hace falta) en un solo total — para armar el mensaje/PDF que se le manda a la persona con lo
// que se le paga (ej. "Prodigio" = varias identidades de agente juntas). Todo en USD
// (weekly_closings ya guarda los montos convertidos con la tasa de esa semana — no hay forma de
// recuperar el monto en moneda local original sin agregarlo al esquema, así que eso se resuelve
// con una nota manual editable en el frontend). También devuelve los adelantos ACTIVOS de esos
// mismos agentes (con su "pendiente" real) para que el frontend permita elegir a mano cuáles se
// cruzan contra el total, en vez de un solo número fijo.
catalogRouter.get("/liquidacion", requireAuth, requireAdmin, async (req, res) => {
  const agentIds = String(req.query.agentIds || "").split(",").map((s) => s.trim()).filter(Boolean);
  const weekStart = String(req.query.weekStart || "");
  if (agentIds.length === 0) return res.status(400).json({ error: "Falta agentIds" });
  if (!weekStart) return res.status(400).json({ error: "Falta weekStart" });
  // system (30/09/2026, pedido de Leo: "separar... que al ir a liquidaciones aparezca que
  // queremos liquidar si win lose o prepago, así los motores quedan independiente y no se
  // pisan" -- surgió justo después de encontrar el bug del pendiente negativo de WIN_LOSE
  // mezclado en un mismo total): opcional, filtra los cierres al sistema elegido -- red de
  // seguridad del lado del servidor además del filtro que ya hace el frontend sobre la lista de
  // agentes (un agente no debería tener nunca los dos sistemas a la vez, pero si algún día pasa,
  // el cierre del otro sistema simplemente queda afuera de esta liquidación en vez de mezclarse).
  const system = req.query.system === "WIN_LOSE" || req.query.system === "PREPAGO" ? String(req.query.system) : null;

  const agentes = await pool.query(`SELECT id, name FROM agents WHERE id = ANY($1::text[])`, [agentIds]);
  if (agentes.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });

  const closings = await pool.query(
    `SELECT wc.*, c.name as club_name, a.name as agent_name FROM weekly_closings wc
     JOIN clubs c ON c.id = wc.club_id
     JOIN agents a ON a.id = wc.agent_id
     WHERE wc.agent_id = ANY($1::text[]) AND wc.week_start = $2 AND wc.status <> 'REVERTIDO' ${system ? "AND wc.system = $3" : ""}
     ORDER BY c.name`,
    system ? [agentIds, weekStart, system] : [agentIds, weekStart]
  );
  if (closings.rows.length === 0) return res.status(404).json({ error: "No hay cierres para esa semana." });

  // ra.agent_id (29/09/2026, pedido de Leo: "si cruzo un adelanto contra el rakeback de la
  // semana, tiene que descontarse también de rakeback pendiente" -- ver saldarPendienteConCruce
  // más abajo): el frontend lo necesita para saber a qué agente pertenece cada adelanto, y así
  // poder buscar SUS filas (con rakebackPendienteId) dentro de esta misma liquidación al cruzar.
  const adelantos = await pool.query(
    `SELECT ra.id, ra.agent_id, ra.amount, ra.consumed, ra.kind, ra.created_at, a.name as agent_name, c.name as club_origen_name
     FROM rakeback_advances ra
     JOIN agents a ON a.id = ra.agent_id
     LEFT JOIN clubs c ON c.id = ra.club_origen_id
     WHERE ra.agent_id = ANY($1::text[]) AND ra.active = true AND ra.amount > ra.consumed
     ORDER BY a.name, ra.created_at`,
    [agentIds]
  );

  // Cargas de tesorería pendientes (21/09/2026): a diferencia de los adelantos (por agente
  // nomás), estas son por agente+club — solo tiene sentido cruzar acá la carga de un club que
  // efectivamente forma parte de ESTA liquidación (si un agente tiene una carga pendiente en un
  // club que no está en esta tanda, no se muestra: se cruzará cuando se liquide ESE club).
  const paresAgenteClub = new Set(closings.rows.map((c) => `${c.agent_id}|${c.club_id}`));
  const cargasPendientes = (await listCargasPendientesPorAgentes(agentIds)).filter((cp) =>
    paresAgenteClub.has(`${cp.agent_id}|${cp.club_id}`)
  );

  // Rakeback pendiente (22/09/2026, pedido de Leo: "no podemos generar el rakeback desde
  // liquidaciones?"): cada cierre nuevo (post-separación stock/pendiente) tiene su propia fila
  // en rakeback_pendiente -- se trae acá para que "Enviar" pueda pagarla de verdad (con medio
  // Fichas/USDT/Efectivo/Zelle) en vez de un PAGO genérico que no sabía nada de esto. Un cierre
  // viejo (de antes de esa separación) no tiene fila acá -- rakebackPendienteId queda null y el
  // frontend cae al comportamiento viejo (PAGO/COBRO genérico) para esos casos.
  //
  // BUG REAL (30/09/2026, encontrado por Leo con el cierre de Tincho ya pagado en full): ANTES
  // este SELECT filtraba "amount > consumed", así que un pendiente YA pagado del todo (amount =
  // consumed) desaparecía de acá -- exactamente el mismo resultado (fila ausente) que un cierre
  // viejo que NUNCA tuvo fila en rakeback_pendiente. El frontend no podía distinguir "esto ya se
  // pagó" de "esto nunca se trackeó", y caía al fallback de rakebackNeto (el monto crudo, sin
  // descontar lo ya pagado) en los dos casos -- por eso "Total a pagar" seguía mostrando 86.96
  // en vez de 0 en un cierre ya saldado. Ahora se trae la fila SIN el filtro de consumido, para
  // poder distinguir los dos casos de verdad: si existe fila (aunque esté en $0 disponible) se
  // usa rakebackPendienteDisponible (puede dar 0, que es lo correcto); si no existe ninguna fila
  // para ese cierre, recién ahí cae al fallback legacy de rakebackNeto.
  const closingIds = closings.rows.map((c) => c.id);
  const pendientesRes = await pool.query(
    `SELECT * FROM rakeback_pendiente WHERE weekly_closing_id = ANY($1::text[]) AND role = 'AGENTE' AND active = true`,
    [closingIds]
  );
  const pendientePorCierre = new Map(pendientesRes.rows.map((p) => [p.weekly_closing_id, p]));

  const filas = closings.rows.map((c) => {
    const pendiente = pendientePorCierre.get(c.id);
    return {
      weeklyClosingId: c.id,
      clubId: c.club_id,
      clubName: c.club_name,
      agentId: c.agent_id,
      agentName: c.agent_name,
      resultado: Number(c.result),
      rakeTotal: Number(c.rake_total),
      rakebackBruto: Number(c.rakeback),
      rebate: Number(c.rebate),
      rakebackNeto: Number(c.rakeback) + Number(c.rebate),
      rakebackPendienteId: pendiente ? pendiente.id : null,
      // SIN Math.max(0, ...) (30/09/2026, bug encontrado por Leo con El Caimán/TeamBack GG,
      // semana 14-20/09: "Total a pagar" daba US$0,00 en vez de mostrar que quedó debiendo
      // US$309,44): un cierre WIN_LOSE con resultado muy negativo puede generar un
      // rakeback_pendiente con amount NEGATIVO (el agente perdió más de lo que generó en
      // rakeback -- ver corregirBalanceWinLose.ts / closings.ts, que ya contemplan esto). El
      // Math.max(0, ...) que había acá (agregado en el fix anterior, pensado solo para el caso
      // "ya pagado del todo") clampeaba también estos casos negativos a $0, escondiendo la
      // deuda real. Ahora se deja pasar el signo tal cual -- mismo criterio que ya usa
      // pendientesAnterioresDetalle en repo/agentesResumen.ts, que nunca clampeó esto.
      rakebackPendienteDisponible: pendiente ? Number(pendiente.amount) - Number(pendiente.consumed) : null,
      // system (24/09/2026, pedido de Leo): el frontend lo necesita para NO ofrecer/tildar
      // "FICHAS" por defecto al pagar el rakeback pendiente de un agente PREPAGO -- un PREPAGO
      // solo tiene fichas por lo que paga por adelantado, pagarle el pendiente en fichas rompe
      // esa regla (ver repo/rakebackPendiente.ts, que ahora también lo bloquea del lado del
      // servidor).
      system: c.system,
    };
  });
  // total (30/09/2026, bug encontrado por Leo -- "Total a pagar" en Tincho seguía mostrando
  // 86.96 en vez de 227.76 después de la corrección de closings.ts): este total ANTES sumaba
  // siempre rakebackNeto (rakeback + rebate), ignorando por completo rakebackPendienteDisponible
  // -- o sea, ignoraba tanto el resultado de mesas ya incluido en WIN_LOSE como cualquier pago
  // parcial ya hecho contra el pendiente. Ahora usa el disponible real cuando el cierre ya tiene
  // su fila en rakeback_pendiente (mismo criterio que ya usaba el footer de la tabla en
  // Liquidaciones.tsx, línea "TOTAL" de la columna Rakeback Pendiente) -- y cae a rakebackNeto
  // SOLO para cierres viejísimos que nunca tuvieron fila en rakeback_pendiente (de antes de la
  // separación stock/pendiente), para no romper esos casos legacy.
  const total = filas.reduce((s, f) => s + (f.rakebackPendienteId ? Number(f.rakebackPendienteDisponible) : f.rakebackNeto), 0);

  // Historial de pagos reales ya registrados para esta liquidación (28/09/2026, pedido de Leo:
  // "un historial ahí mismo de a dónde fueron los pagos y cómo fueron") -- dos fuentes, porque
  // el sistema tiene dos caminos de pago (ver comentario de rakeback_pendiente más arriba):
  //   1) Cierres nuevos (con rakebackPendienteId): pagos vía pagarPendiente() -- quedan en
  //      rakeback_pendiente_movements (type PAGO_FICHAS/PAGO_USDT), ligados 1 a 1 a esta semana
  //      a través de weekly_closing_id -- 100% preciso.
  //   2) Cierres viejos sin migrar: pagos vía crearMovimiento() genérico (PAGO/COBRO) directo
  //      sobre ledger_movements, sin ningún campo que los ligue a una semana puntual -- se
  //      matchean por agente+club+observación conteniendo "cierre <weekStart>" (el texto que
  //      Liquidaciones.tsx manda por default en la observación) -- best effort: si alguien borró
  //      o cambió esa observación a mano, ese pago puntual no va a aparecer acá.
  const clubIds = [...new Set(closings.rows.map((c) => c.club_id))];
  const pagosModernos = await pool.query(
    `SELECT rpm.id, rpm.type, rpm.amount, rpm.occurred_at, rpm.notes,
            lm.payment_method, lm.observation, te.custodian,
            a.name as agent_name, c.name as club_name, rpm.agent_id as agent_id, rp.club_id as club_id
     FROM rakeback_pendiente_movements rpm
     JOIN rakeback_pendiente rp ON rp.id = rpm.pendiente_id
     JOIN agents a ON a.id = rpm.agent_id
     JOIN clubs c ON c.id = rp.club_id
     LEFT JOIN ledger_movements lm ON lm.id = rpm.movement_id
     LEFT JOIN treasury_entries te ON te.movement_id = rpm.movement_id
     WHERE rp.weekly_closing_id = ANY($1::text[]) AND rpm.type IN ('PAGO_FICHAS', 'PAGO_USDT')
     ORDER BY rpm.occurred_at DESC`,
    [closingIds]
  );
  // (28/09/2026, pedido de Leo: "puedo ver los viejos?" -- el match solo por observación se
  // perdía cualquier pago genérico cuya observación no tuviera el texto exacto "cierre
  // <semana>", por ejemplo si se pagó desde Movimientos directo o se editó la observación a
  // mano) -- ahora también entran los PAGO/COBRO de estos agentes+clubes cuya fecha caiga
  // dentro de la semana del cierre (con un margen de 10 días después, para pagos que se hacen
  // un poco más tarde que el cierre en sí). Sigue siendo "best effort" para cierres viejos: sin
  // ningún campo que ligue el movimiento a una semana puntual, un pago hecho MUCHO después (o
  // con fecha manual mal cargada) puede seguir sin aparecer -- no hay forma 100% precisa para
  // estos casos viejos, ver comentario más arriba sobre rakeback_pendiente.
  const weekEndRow = closings.rows[0].week_end;
  const pagosGenericos =
    clubIds.length === 0
      ? { rows: [] }
      : await pool.query(
          `SELECT lm.id, lm.type, lm.amount, lm.occurred_at, NULL as notes,
                  lm.payment_method, lm.observation, te.custodian,
                  a.name as agent_name, c.name as club_name, lm.agent_id as agent_id, lm.club_id as club_id
           FROM ledger_movements lm
           JOIN agents a ON a.id = lm.agent_id
           JOIN clubs c ON c.id = lm.club_id
           LEFT JOIN treasury_entries te ON te.movement_id = lm.id
           WHERE lm.agent_id = ANY($1::text[]) AND lm.club_id = ANY($2::text[])
             AND lm.type IN ('PAGO', 'COBRO') AND lm.status = 'APLICADO'
             AND (
               lm.observation ILIKE $3
               OR lm.occurred_at BETWEEN $4::date AND ($5::date + INTERVAL '10 days')
             )
           ORDER BY lm.occurred_at DESC`,
          [agentIds, clubIds, `%cierre ${weekStart}%`, weekStart, weekEndRow]
        );
  const pagos = [...pagosModernos.rows, ...pagosGenericos.rows]
    .map((p) => ({
      id: p.id,
      tipo: p.type,
      agentId: p.agent_id,
      clubId: p.club_id,
      agentName: p.agent_name,
      clubName: p.club_name,
      amount: Number(p.amount),
      medio: p.payment_method ?? (p.type === "PAGO_FICHAS" ? "FICHAS" : null),
      custodian: p.custodian ?? null,
      occurredAt: p.occurred_at,
      observation: p.observation ?? p.notes ?? null,
    }))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  res.json({
    agentes: agentes.rows,
    weekStart: closings.rows[0].week_start,
    weekEnd: closings.rows[0].week_end,
    filas,
    total,
    adelantos: adelantos.rows.map((a) => ({
      id: a.id,
      agentId: a.agent_id,
      agentName: a.agent_name,
      clubOrigenName: a.club_origen_name,
      kind: a.kind,
      amount: Number(a.amount),
      consumed: Number(a.consumed),
      pendiente: Number(a.amount) - Number(a.consumed),
      createdAt: a.created_at,
    })),
    cargas: cargasPendientes.map((cp) => ({
      id: cp.id,
      agentName: cp.agent_name,
      clubName: cp.club_name,
      amount: Number(cp.amount),
      consumed: Number(cp.consumed),
      pendiente: Number(cp.amount) - Number(cp.consumed),
      createdAt: cp.created_at,
    })),
    pagos,
  });
});

// Cruza (consume) una carga de tesorería pendiente contra el rakeback de una liquidación —
// mismo efecto que POST /advances/ajuste con type CONSUMO, pero sobre carga_pendientes_cruce en
// vez de rakeback_advances (ver repo/cargaCruces.ts).
const ajusteCargaSchema = z.object({
  cargaId: z.string(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});
catalogRouter.post("/liquidacion/carga/consumir", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteCargaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const carga = await consumirCarga({
      cargaId: parsed.data.cargaId,
      amount: parsed.data.amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(carga);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Deshace UN cruce (CONSUMO) puntual sobre una carga -- misma idea que
// DELETE /advances/movimientos/:id, ver nota en repo/cargaCruces.ts. Solo el más reciente.
catalogRouter.delete("/liquidacion/carga/movimientos/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarMovimientoCarga(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real de una carga pendiente (ej. cargada de prueba, o al agente/club equivocado) --
// misma idea que DELETE /advances/:id, ver nota en repo/cargaCruces.ts.
catalogRouter.delete("/liquidacion/carga/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarCarga(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Guarda una FOTO congelada de una liquidación ya armada (filas, totales, nota) para que quede
// en un historial consultable — a diferencia de GET /liquidacion (arriba), que siempre recalcula
// en vivo. Se guarda recién cuando el usuario confirma que esto es lo que se mandó de verdad.
const guardarLiquidacionSchema = z.object({
  nombreGrupo: z.string().min(1),
  agentIds: z.array(z.string()).min(1),
  weekStart: z.string(),
  weekEnd: z.string(),
  filas: z.array(z.any()),
  total: z.number(),
  adelantosAplicados: z.number().default(0),
  adelantosManual: z.number().default(0),
  cargasAplicadas: z.number().default(0),
  totalAPagar: z.number(),
  nota: z.string().nullable().optional(),
  // IDs de rakeback_advance_movements/carga_cruce_movements (tipo CONSUMO) generados por los
  // cruces aplicados en ESTA liquidación puntual -- se guardan para poder liberarlos después
  // desde "Revisar" (ver POST /liquidacion/liberar-cruces más abajo). Vienen de la sesión del
  // navegador (Liquidaciones.tsx acumula los movIds de cada aplicarCruces/aplicarCrucesCarga).
  adelantoMovIds: z.array(z.string()).default([]),
  cargaMovIds: z.array(z.string()).default([]),
  // IDs de pagos reales ya aplicados en ESTA liquidación puntual (28/09/2026, pedido de Leo:
  // "cuando eliminamos una liquidación todo tiene que volver para atrás") -- mismo criterio que
  // adelantoMovIds/cargaMovIds, pero para "Enviar"/"Recibir" (que aplican al ledger al toque,
  // ver Liquidaciones.tsx -> registrarMov()). Separado en dos porque cada uno se revierte
  // distinto: pagoPendienteMovIds son rakeback_pendiente_movements (pagarPendiente, cierres
  // nuevos), pagoLedgerMovIds son ledger_movements crudos (crearMovimiento PAGO/COBRO, cierres
  // viejos sin rakebackPendienteId).
  pagoPendienteMovIds: z.array(z.string()).default([]),
  pagoLedgerMovIds: z.array(z.string()).default([]),
  // Si viene, en vez de insertar una fila nueva en el historial se pisa la fila existente con
  // este id -- "rehacer" una liquidación ya Pagada reemplaza el registro original en vez de
  // duplicarlo (pedido de Leo).
  reemplazarId: z.string().optional(),
  // "Cerrar liquidación" (29/09/2026, pedido de Leo): armar y guardar la liquidación SIN
  // enviar/recibir plata todavía, en un estado propio ("CERRADA") distinto de PENDIENTE
  // (borrador que se sigue autoguardando/recalculando solo) y de PAGADA (que hasta ahora se
  // marcaba, por error, apenas se apretaba "Guardar en historial" -- ver más abajo). Una
  // liquidación Cerrada es la que se elige después desde el historial para recién ahí mandar o
  // recibir el pago de verdad.
  cerrar: z.boolean().default(false),
});

// grupo_key: mismo grupo de agentes sin importar el orden en que se tildaron -- para poder
// upsertear el autoguardado "vivo" (ver abajo) y para matchear el resolver contra el guardado.
function grupoKey(agentIds: string[]): string {
  return [...agentIds].sort().join(",");
}

catalogRouter.post("/liquidacion/guardar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = guardarLiquidacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  // 29/09/2026, bug real que encontró Leo ("hay mucho lío en las liquidaciones... si un cierre
  // o una liquidación está realizada, por qué desaparece"): sin esto, "Guardar en historial"
  // SIEMPRE insertaba una fila nueva salvo que reemplazarId viniera seteado a mano (solo pasa
  // al usar "Liberar cruces" sobre una ya Pagada) -- pero el autoguardado (más abajo) YA había
  // creado antes una fila PENDIENTE para este mismo grupo+semana, y encima el pago real la
  // vuelve PAGADA sola (ver /liquidacion/resolver) sin actualizar su created_at. Resultado:
  // terminaban quedando DOS filas para la misma liquidación real -- una (la del autoguardado,
  // resuelta a PAGADA con fecha vieja) y otra nueva (la de este Guardar). Con el historial
  // ordenado por created_at DESC y LIMIT 200, la más vieja de las dos terminaba tapada por
  // drafts más nuevos de otros grupos -- "desaparecía" aunque la liquidación estuviera pagada
  // de verdad. Ahora, si no vino reemplazarId a mano, se busca si ya existe ALGUNA fila (de
  // cualquier estado) para este mismo grupo+semana y se pisa esa en vez de crear una nueva.
  //
  // reemplazarExplicito (29/09/2026, bug relacionado que reportó Leo: "esa liquidación
  // guardada... no como está ahora que queda mal") -- OJO: reemplazarId puede llegar de DOS
  // lugares muy distintos y hay que tratarlos distinto: (a) el frontend lo manda a mano después
  // de "Liberar cruces de esta liquidación" (rehacer una ya Pagada -- ahí SÍ hay que dejarla
  // Pagada de nuevo, pedido explícito de Leo), o (b) lo completa el bloque de arriba solo porque
  // YA existía un borrador (normalmente PENDIENTE, del autoguardado) para este mismo grupo+
  // semana -- ahí NO hay que forzar 'PAGADA' con solo guardar/cerrar, porque no se mandó ni
  // recibió un peso todavía. Por eso se guarda el valor ORIGINAL antes de que el bloque de abajo
  // lo pise.
  const reemplazarExplicito = !!d.reemplazarId;
  let estadoExistente: string | null = null;
  if (!d.reemplazarId) {
    const existente = await pool.query(
      `SELECT id, estado FROM liquidaciones_guardadas WHERE grupo_key = $1 AND week_start = $2 ORDER BY created_at DESC LIMIT 1`,
      [grupoKey(d.agentIds), d.weekStart]
    );
    if (existente.rows[0]) {
      d.reemplazarId = existente.rows[0].id;
      estadoExistente = existente.rows[0].estado;
    }
  }

  if (d.reemplazarId) {
    // 'PAGADA' solo si vino reemplazarId de verdad desde el frontend (rehacer una ya Pagada
    // después de "Liberar cruces"). 'CERRADA' si se pidió cerrar explícitamente. Si no,
    // preserva el estado que YA tenía la fila encontrada (no la "desmarca" sola con un guardado
    // de rutina) -- y si es una fila nueva para nosotros pero sin estado previo, PENDIENTE.
    const estadoNuevo = reemplazarExplicito ? "PAGADA" : d.cerrar ? "CERRADA" : estadoExistente ?? "PENDIENTE";
    const r = await pool.query(
      `UPDATE liquidaciones_guardadas SET
         nombre_grupo = $1, agent_ids = $2, week_start = $3, week_end = $4, filas = $5, total = $6,
         adelantos_aplicados = $7, adelantos_manual = $8, cargas_aplicadas = $9, total_a_pagar = $10,
         nota = $11, created_by = $12, grupo_key = $13, estado = $14,
         adelanto_movement_ids = $15, carga_movement_ids = $16,
         pago_pendiente_movement_ids = $17, pago_ledger_movement_ids = $18, created_at = now()
       WHERE id = $19 RETURNING *`,
      [
        d.nombreGrupo,
        d.agentIds,
        d.weekStart,
        d.weekEnd,
        JSON.stringify(d.filas),
        d.total,
        d.adelantosAplicados,
        d.adelantosManual,
        d.cargasAplicadas,
        d.totalAPagar,
        d.nota ?? null,
        req.user?.email ?? null,
        grupoKey(d.agentIds),
        estadoNuevo,
        d.adelantoMovIds,
        d.cargaMovIds,
        d.pagoPendienteMovIds,
        d.pagoLedgerMovIds,
        d.reemplazarId,
      ]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "No se encontró la liquidación a reemplazar." });
    return res.status(200).json(r.rows[0]);
  }

  // Fila nueva de verdad (no existía ningún borrador previo para este grupo+semana): 'CERRADA'
  // si se pidió cerrar explícitamente, 'PENDIENTE' en cualquier otro guardado manual (mismo
  // estado que ya usa el autoguardado) -- 'PAGADA' queda reservada para cuando se registra un
  // pago/cobro real (ver /liquidacion/resolver) o para rehacer una que ya estaba Pagada.
  const estadoNuevo = d.cerrar ? "CERRADA" : "PENDIENTE";
  const r = await pool.query(
    `INSERT INTO liquidaciones_guardadas
       (id, nombre_grupo, agent_ids, week_start, week_end, filas, total, adelantos_aplicados, adelantos_manual, cargas_aplicadas, total_a_pagar, nota, created_by, grupo_key, estado, adelanto_movement_ids, carga_movement_ids, pago_pendiente_movement_ids, pago_ledger_movement_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [
      newId("liq"),
      d.nombreGrupo,
      d.agentIds,
      d.weekStart,
      d.weekEnd,
      JSON.stringify(d.filas),
      d.total,
      d.adelantosAplicados,
      d.adelantosManual,
      d.cargasAplicadas,
      d.totalAPagar,
      d.nota ?? null,
      req.user?.email ?? null,
      grupoKey(d.agentIds),
      estadoNuevo,
      d.adelantoMovIds,
      d.cargaMovIds,
      d.pagoPendienteMovIds,
      d.pagoLedgerMovIds,
    ]
  );
  res.status(201).json(r.rows[0]);
});

// Autoguardado (24/09/2026, pedido de Leo): apenas se calcula una liquidación para un grupo de
// agentes + semana, se guarda sola como PENDIENTE -- sin que nadie tenga que tocar "Guardar en
// historial". Después, cuando se sepa cómo pagarla (fichas o USDT), se retoma desde el
// historial. Upsert por (grupo_key, week_start): cada recálculo (cambia una venta, un ticket, la
// nota) PISA el mismo borrador en vez de acumular filas repetidas -- ver índice único parcial en
// schema.sql. Puramente informativo: no mueve plata ni toca ningún otro dato.
catalogRouter.post("/liquidacion/autoguardar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = guardarLiquidacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const key = grupoKey(d.agentIds);

  // Red de seguridad extra (30/09/2026, mismo bug que reportó Leo: "si aplicas el cierre y
  // después retomas desaparece el cruce") -- el índice único parcial de abajo solo protege
  // contra dos PENDIENTE del mismo grupo+semana; si ya hay una CERRADA o PAGADA para este mismo
  // grupo+semana (por ejemplo, un autoguardado que quedó programado ANTES de cerrarla y disparó
  // igual un segundo después), el ON CONFLICT no la encuentra como conflicto y terminaría
  // insertando una fila PENDIENTE duplicada -- que después "Retomar"/"elegir semana" podían
  // confundir con la de verdad. El arreglo de fondo ya está en el frontend (el autoguardado se
  // cancela solo al cerrar/retomar), pero esto es un resguardo por si igual llega un autoguardado
  // tarde: si ya existe una CERRADA/PAGADA para este grupo+semana, no se toca nada.
  const yaCerradaOPagada = await pool.query(
    `SELECT id FROM liquidaciones_guardadas WHERE grupo_key = $1 AND week_start = $2 AND estado IN ('CERRADA', 'PAGADA') LIMIT 1`,
    [key, d.weekStart]
  );
  if (yaCerradaOPagada.rows[0]) {
    return res.json({ ok: true, omitido: true });
  }

  const r = await pool.query(
    `INSERT INTO liquidaciones_guardadas
       (id, nombre_grupo, agent_ids, week_start, week_end, filas, total, adelantos_aplicados, adelantos_manual, cargas_aplicadas, total_a_pagar, nota, created_by, grupo_key, estado, adelanto_movement_ids, carga_movement_ids, pago_pendiente_movement_ids, pago_ledger_movement_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDIENTE',$15,$16,$17,$18)
     ON CONFLICT (grupo_key, week_start) WHERE estado = 'PENDIENTE'
     DO UPDATE SET nombre_grupo = EXCLUDED.nombre_grupo, agent_ids = EXCLUDED.agent_ids,
       week_end = EXCLUDED.week_end, filas = EXCLUDED.filas, total = EXCLUDED.total,
       adelantos_aplicados = EXCLUDED.adelantos_aplicados, adelantos_manual = EXCLUDED.adelantos_manual,
       cargas_aplicadas = EXCLUDED.cargas_aplicadas, total_a_pagar = EXCLUDED.total_a_pagar,
       nota = EXCLUDED.nota, created_by = EXCLUDED.created_by, created_at = now(),
       adelanto_movement_ids = EXCLUDED.adelanto_movement_ids, carga_movement_ids = EXCLUDED.carga_movement_ids,
       pago_pendiente_movement_ids = EXCLUDED.pago_pendiente_movement_ids, pago_ledger_movement_ids = EXCLUDED.pago_ledger_movement_ids
     RETURNING *`,
    [
      newId("liq"),
      d.nombreGrupo,
      d.agentIds,
      d.weekStart,
      d.weekEnd,
      JSON.stringify(d.filas),
      d.total,
      d.adelantosAplicados,
      d.adelantosManual,
      d.cargasAplicadas,
      d.totalAPagar,
      d.nota ?? null,
      req.user?.email ?? null,
      key,
      d.adelantoMovIds,
      d.cargaMovIds,
      d.pagoPendienteMovIds,
      d.pagoLedgerMovIds,
    ]
  );
  res.status(201).json(r.rows[0]);
});

// Marca como resuelto (PAGADA) el autoguardado PENDIENTE de este grupo+semana, si existe -- se
// llama apenas se registra CUALQUIER pago o cobro real para estos mismos agentes (ver
// Liquidaciones.tsx, registrarMov). No hace nada si no había ningún borrador pendiente.
const resolverLiquidacionSchema = z.object({
  agentIds: z.array(z.string()).min(1),
  weekStart: z.string(),
});
catalogRouter.post("/liquidacion/resolver", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = resolverLiquidacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // created_at = now() (29/09/2026, mismo bug de arriba): sin esto, una liquidación que se
  // resuelve sola (autoguardado -> primer pago real) se queda con la fecha vieja de cuando era
  // todavía un borrador recién calculado -- en el historial (created_at DESC, LIMIT 200) eso la
  // hacía "hundirse" y desaparecer de la vista aunque ya estuviera pagada de verdad.
  // También resuelve desde 'CERRADA' (29/09/2026): una liquidación cerrada sin pagar es
  // justamente la que se retoma para mandar/recibir el pago de verdad -- apenas eso pasa, tiene
  // que quedar Pagada igual que si viniera de un borrador Pendiente.
  const r = await pool.query(
    `UPDATE liquidaciones_guardadas SET estado = 'PAGADA', created_at = now()
     WHERE grupo_key = $1 AND week_start = $2 AND estado IN ('PENDIENTE', 'CERRADA')
     RETURNING id`,
    [grupoKey(parsed.data.agentIds), parsed.data.weekStart]
  );
  res.json({ ok: true, resueltas: r.rowCount ?? 0 });
});

// "Reabrir para editar" una liquidación Cerrada (29/09/2026, pedido de Leo) -- la vuelve a
// PENDIENTE para que se pueda seguir tocando (autoguardándose sola de nuevo) antes de mandar el
// pago. No revierte ningún cruce ni pago real -- los adelantos/cargas que ya se cruzaron
// mientras estaba "armándose" siguen consumidos de verdad (eso no cambia solo por reabrirla);
// esto es solo la etiqueta de estado. Si hiciera falta deshacer cruces de verdad, para eso está
// "Liberar cruces de esta liquidación" (solo disponible hoy para las Pagadas).
catalogRouter.post("/liquidacion/:id/reabrir", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const r = await pool.query(
    `UPDATE liquidaciones_guardadas SET estado = 'PENDIENTE' WHERE id = $1 AND estado = 'CERRADA' RETURNING id`,
    [req.params.id]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "No se encontró una liquidación Cerrada con ese id." });
  res.json({ ok: true });
});

// "Liberar cruces" de una liquidación ya guardada (23/09/2026 cont., pedido de Leo: poder
// rehacer una liquidación Pagada y reusar el monto descontado). Deshace, uno por uno, los
// movimientos de consumo (rakeback_advances/carga_pendientes_cruce) que quedaron asociados a
// esta liquidación puntual -- mismo mecanismo que "Deshacer último cruce" en Liquidaciones.tsx
// (eliminarMovimientoAdelanto/eliminarMovimientoCarga), con la misma limitación real: si ese
// adelanto/carga tuvo otro ajuste MÁS NUEVO encima (desde la pantalla de Adelantos, por
// ejemplo), el backend rechaza deshacer ese movimiento puntual porque ya no es el más reciente
// -- se informa como error individual, no rompe el resto. Al final, vacía los ids en esta fila
// (se hayan podido deshacer o no) para no reintentar sobre movimientos que ya no existen.
// Función compartida entre POST /liquidacion/liberar-cruces (rehacer una liquidación Pagada) y
// DELETE /liquidacion/historial/:id (28/09/2026, pedido de Leo: "si eliminamos la liquidación
// todos los cruces realizados deberían ir para atrás" -- antes el borrado NO tocaba los cruces,
// quedaban aplicados igual aunque la foto de la liquidación ya no existiera).
async function liberarCrucesDeLiquidacion(id: string) {
  const liqRes = await pool.query(
    `SELECT id, adelanto_movement_ids, carga_movement_ids, pago_pendiente_movement_ids FROM liquidaciones_guardadas WHERE id = $1`,
    [id]
  );
  const liq = liqRes.rows[0];
  if (!liq) return null;

  const errores: string[] = [];
  let liberados = 0;
  for (const movId of liq.adelanto_movement_ids ?? []) {
    try {
      await eliminarMovimientoAdelanto(movId);
      liberados++;
    } catch (err: any) {
      errores.push(`Adelanto: ${err.message || "no se pudo deshacer"}`);
    }
  }
  for (const movId of liq.carga_movement_ids ?? []) {
    try {
      await eliminarMovimientoCarga(movId);
      liberados++;
    } catch (err: any) {
      errores.push(`Carga: ${err.message || "no se pudo deshacer"}`);
    }
  }

  // Rakeback pendiente saldado CON un cruce (29/09/2026, pedido de Leo -- ver
  // saldarPendienteConCruce en repo/rakebackPendiente.ts): a diferencia de un pago real
  // (PAGO_FICHAS/PAGO_USDT, esos NUNCA se tocan acá -- ver revertirPagosDeLiquidacion, que a
  // propósito no se llama desde "Liberar cruces"), un CRUCE_ADELANTO no es plata mandada de
  // verdad, está atado 1 a 1 al cruce de adelanto que se acaba de liberar arriba -- así que
  // tiene que liberarse junto con él, si no queda "huérfano": el adelanto vuelve a estar
  // disponible pero el rakeback pendiente se sigue mostrando como pagado. Solo se tocan los
  // que son CRUCE_ADELANTO -- los reales quedan intactos en el arreglo.
  const pagoPendienteIdsRestantes: string[] = [];
  for (const movId of liq.pago_pendiente_movement_ids ?? []) {
    const tipoRes = await pool.query(`SELECT type FROM rakeback_pendiente_movements WHERE id = $1`, [movId]);
    if (tipoRes.rows[0]?.type !== "CRUCE_ADELANTO") {
      pagoPendienteIdsRestantes.push(movId);
      continue;
    }
    try {
      await revertirPagoPendiente(movId);
      liberados++;
    } catch (err: any) {
      errores.push(`Rakeback pendiente: ${err.message || "no se pudo deshacer"}`);
      pagoPendienteIdsRestantes.push(movId);
    }
  }

  await pool.query(
    `UPDATE liquidaciones_guardadas SET adelanto_movement_ids = '{}', carga_movement_ids = '{}', pago_pendiente_movement_ids = $2 WHERE id = $1`,
    [liq.id, pagoPendienteIdsRestantes]
  );

  return { liberados, errores };
}

// Revierte los PAGOS DE VERDAD ("Enviar"/"Recibir", ver registrarMov() en Liquidaciones.tsx) que
// quedaron aplicados por esta liquidación puntual (28/09/2026, pedido de Leo: "cuando eliminamos
// una liquidación todo tiene que volver para atrás" -- antes solo se llamaba a
// liberarCrucesDeLiquidacion, que NUNCA tocó los pagos reales, solo los cruces de adelantos/
// cargas). Usada SOLO desde DELETE /liquidacion/historial/:id -- a propósito no se usa desde
// "Liberar cruces" (rehacer una Pagada), porque ahí la plata ya se mandó de verdad y no
// corresponde deshacerla solo por recalcular montos.
async function revertirPagosDeLiquidacion(id: string) {
  const liqRes = await pool.query(
    `SELECT id, pago_pendiente_movement_ids, pago_ledger_movement_ids FROM liquidaciones_guardadas WHERE id = $1`,
    [id]
  );
  const liq = liqRes.rows[0];
  if (!liq) return null;

  const errores: string[] = [];
  let revertidos = 0;
  for (const movId of liq.pago_pendiente_movement_ids ?? []) {
    try {
      await revertirPagoPendiente(movId);
      revertidos++;
    } catch (err: any) {
      errores.push(`Pago: ${err.message || "no se pudo revertir"}`);
    }
  }
  for (const movId of liq.pago_ledger_movement_ids ?? []) {
    try {
      await eliminarMovimientoLedger(movId, { ignorarOrden: true });
      revertidos++;
    } catch (err: any) {
      errores.push(`Pago: ${err.message || "no se pudo revertir"}`);
    }
  }

  await pool.query(
    `UPDATE liquidaciones_guardadas SET pago_pendiente_movement_ids = '{}', pago_ledger_movement_ids = '{}' WHERE id = $1`,
    [liq.id]
  );

  return { revertidos, errores };
}

const liberarCrucesSchema = z.object({ id: z.string().min(1) });
catalogRouter.post("/liquidacion/liberar-cruces", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = liberarCrucesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await liberarCrucesDeLiquidacion(parsed.data.id);
  if (!r) return res.status(404).json({ error: "No se encontró la liquidación." });
  res.json({ ok: true, ...r });
});

// Historial de liquidaciones guardadas — más reciente primero.
catalogRouter.get("/liquidacion/historial", requireAuth, requireAdmin, async (_req, res) => {
  // LIMIT subido de 200 a 1000 (29/09/2026, mismo bug de arriba): con el bug de filas
  // duplicadas ya arreglado en /liquidacion/guardar y /liquidacion/resolver, esto no debería
  // volver a hacer falta, pero mientras haya duplicados viejos de antes del fix dando vueltas,
  // un límite más generoso evita que una liquidación pagada de verdad quede tapada.
  const r = await pool.query(`SELECT * FROM liquidaciones_guardadas ORDER BY created_at DESC LIMIT 1000`);
  res.json(r.rows);
});

// AGREGADO 05/10/2026 (pedido de Leo: "no podemos ver a quién le cobró el rakeback pendiente"):
// resuelve adelanto_movement_ids/pago_pendiente_movement_ids de una liquidación guardada a algo
// legible -- antes esa info solo existía como arrays de ids sueltos en la fila, sin mostrarse en
// ningún lado. Dos listas separadas porque son dos lados del mismo cruce (ver confirmarModalCruce
// en Liquidaciones.tsx): adelantosCruzados es el lado del adelanto (siempre se guardó bien,
// CONSUMO ya estaba permitido) y pendienteSaldado es el lado del rakeback pendiente (el que
// tenía el bug de la constraint -- para liquidaciones guardadas ANTES del fix del 05/10/2026
// puede salir vacío aunque adelantosCruzados sí tenga filas, justamente porque ese INSERT
// fallaba). Se muestran juntas para que, aunque una de las dos esté incompleta por el bug viejo,
// la otra siga sirviendo para entender qué pasó.
catalogRouter.get("/liquidacion/:id/cruces-detalle", requireAuth, requireAdmin, async (req, res) => {
  const liq = await pool.query(
    `SELECT adelanto_movement_ids, pago_pendiente_movement_ids FROM liquidaciones_guardadas WHERE id = $1`,
    [req.params.id]
  );
  if (!liq.rows[0]) return res.status(404).json({ error: "No se encontró esa liquidación." });
  const { adelanto_movement_ids, pago_pendiente_movement_ids } = liq.rows[0];

  const adelantosCruzados = (adelanto_movement_ids ?? []).length
    ? (
        await pool.query(
          `SELECT ram.id, ram.amount, ram.occurred_at, ram.notes, a.name as agent_name, co.name as club_origen_name
           FROM rakeback_advance_movements ram
           JOIN rakeback_advances ra ON ra.id = ram.advance_id
           JOIN agents a ON a.id = ram.agent_id
           LEFT JOIN clubs co ON co.id = ra.club_origen_id
           WHERE ram.id = ANY($1::text[])
           ORDER BY ram.occurred_at`,
          [adelanto_movement_ids]
        )
      ).rows
    : [];

  const pendienteSaldado = (pago_pendiente_movement_ids ?? []).length
    ? (
        await pool.query(
          `SELECT rpm.id, rpm.type, rpm.amount, rpm.occurred_at, rpm.notes, a.name as agent_name,
                  c.name as club_name, wc.week_start, wc.week_end
           FROM rakeback_pendiente_movements rpm
           JOIN rakeback_pendiente rp ON rp.id = rpm.pendiente_id
           JOIN agents a ON a.id = rpm.agent_id
           JOIN clubs c ON c.id = rp.club_id
           JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
           WHERE rpm.id = ANY($1::text[])
           ORDER BY rpm.occurred_at`,
          [pago_pendiente_movement_ids]
        )
      ).rows
    : [];

  res.json({ adelantosCruzados, pendienteSaldado });
});

// Borrado real — para limpiar liquidaciones de PRUEBA. (28/09/2026, pedido de Leo) Antes de
// borrar la foto/reporte, libera los cruces (CONSUMO) que esta liquidación puntual generó
// contra adelantos de rakeback y cargas de tesorería -- mismo mecanismo que
// /liquidacion/liberar-cruces -- para que no queden adelantos/cargas "comidos" por una
// liquidación que ya no existe. Si algún cruce no se puede deshacer (por ejemplo porque tiene
// un ajuste más nuevo encima), se informa en `errores` pero la liquidación se borra igual.
catalogRouter.delete("/liquidacion/historial/:id", requireAuth, requireAdmin, async (req, res) => {
  const liberado = await liberarCrucesDeLiquidacion(req.params.id);
  // 28/09/2026, pedido de Leo: acá faltaba esto -- antes solo se liberaban los cruces (arriba),
  // los pagos reales (Enviar/Recibir) quedaban aplicados igual aunque la liquidación que los
  // originó ya no existiera.
  const pagos = await revertirPagosDeLiquidacion(req.params.id);
  const r = await pool.query(`DELETE FROM liquidaciones_guardadas WHERE id = $1 RETURNING id`, [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "No se encontró esa liquidación guardada." });
  res.json({ ok: true, cruces: liberado, pagos });
});

// Motor de reglas configurable (reemplaza "if agente === 'Manzur'" por una tabla versionada).
catalogRouter.get("/agents/:id/rules", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listRulesForAgent(req.params.id));
});

// Vista global: todas las reglas especiales de todos los agentes juntas, para no tener que
// entrar agente por agente a buscar cuáles están activas.
catalogRouter.get("/rules", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAllRules());
});

// Árbol Club -> Agentes (con % vigente) para la vista de administración. Los jugadores de cada
// agente se piden aparte, on-demand, al expandir.
catalogRouter.get("/arbol", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getArbolClubes());
});

catalogRouter.get("/clubs/:clubId/agents/:agentId/players", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getJugadoresDeAgenteEnClub(req.params.clubId, req.params.agentId));
});

// Roster completo de un agente en TODOS sus clubes — para el árbol de "Supervisores".
catalogRouter.get("/agents/:agentId/players", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getJugadoresDeAgente(req.params.agentId));
});

// Config vigente (deal propio o default del club) de un agente en un club, AHORA MISMO. Se usa
// para refrescar la vista previa de un cierre importado si el deal se creó/editó DESPUÉS de
// analizar el archivo (BIT: la previa de importación quedaba con el % viejo hasta resubir el
// excel entero, porque previsualizarCierre nunca vuelve a resolver el % — solo hace la cuenta
// con lo que le mandan).
catalogRouter.get("/agents/:agentId/clubs/:clubId/config-vigente", requireAuth, requireAdmin, async (req, res) => {
  res.json(await resolverConfigVigente(req.params.agentId, req.params.clubId));
});

// Borra una fila de jugador mal asignada (ej. quedó en el club equivocado por el bug del
// import_source viejo). No toca weekly_closings/ledger_movements — ver nota en repo/catalog.ts.
// Después de borrar, el jugador se vuelve a cargar a mano en el club correcto.
catalogRouter.delete("/players/:id", requireAuth, requireAdmin, async (req, res) => {
  const ok = await eliminarJugador(req.params.id);
  if (!ok) return res.status(404).json({ error: "Jugador no encontrado" });
  res.status(204).send();
});

// "Jugadores bancados": pantalla dedicada para buscar un jugador (por nombre/ID) y marcarlo/
// desmarcarlo, y ver de un vistazo a todos los que ya están marcados en cualquier club.
catalogRouter.get("/jugadores-bancados", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listJugadoresBancados());
});

catalogRouter.get("/players/buscar", requireAuth, requireAdmin, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  if (q.trim().length < 2) return res.json([]);
  res.json(await buscarJugadores(q));
});

const jugadorBancadoSchema = z.object({ bancado: z.boolean() });
catalogRouter.patch("/players/:id/bancado", requireAuth, requireAdmin, async (req, res) => {
  const parsed = jugadorBancadoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await setJugadorBancado(req.params.id, parsed.data.bancado);
  if (!r) return res.status(404).json({ error: "Jugador no encontrado" });
  res.json(r);
});

// Subagente de un jugador puntual (% de rakeback propio, distinto al de su agente) — ver
// schema.sql (columnas players.subagente_name/subagente_rakeback_pct) y repo/catalog.ts.
// Nombre y % son independientes: se puede guardar solo el % (override personal del jugador,
// sin armar una liquidación de subagente aparte) o nombre + % (arma la liquidación aparte,
// ver "Resumen por agente"). Si viene nombre, el % es obligatorio (0..1) -- al revés no.
const subagenteSchema = z.object({
  subagenteName: z.string().trim().min(1).max(80).nullable(),
  rakebackPct: z.number().min(0).max(1).nullable(),
}).refine((v) => v.subagenteName === null || v.rakebackPct !== null, {
  message: "Si se asigna un nombre de subagente, el % de rakeback propio es obligatorio.",
});
catalogRouter.patch("/players/:id/subagente", requireAuth, requireAdmin, async (req, res) => {
  const parsed = subagenteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await setSubagenteJugador(req.params.id, parsed.data.subagenteName, parsed.data.rakebackPct);
  if (!r) return res.status(404).json({ error: "Jugador no encontrado" });
  res.json(r);
});

const moverAgenteSchema = z.object({ toClubId: z.string().min(1) });
// Mueve de una todos los jugadores de un agente, de un club al club correcto — para arreglar
// de un click el caso de un agente entero mal cargado en el club equivocado (ver árbol de clubes).
catalogRouter.post("/clubs/:clubId/agents/:agentId/move", requireAuth, requireAdmin, async (req, res) => {
  const parsed = moverAgenteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await moverAgenteDeClub(req.params.clubId, req.params.agentId, parsed.data.toClubId);
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const ruleSchema = z.object({
  ruleKey: z.enum(RULE_KEYS),
  params: z.record(z.string(), z.number()),
  description: z.string().min(3),
  clubId: z.string().nullable().optional(), // null/omitido = regla global del agente
});
catalogRouter.post("/agents/:id/rules", requireAuth, requireAdmin, async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const id = await addRuleVersion(req.params.id, parsed.data.ruleKey, parsed.data.params, parsed.data.description, parsed.data.clubId ?? null);
    res.status(201).json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Termina una regla vigente (el agente vuelve a la fórmula genérica desde ahora). No la borra:
// queda en el historial con valid_to seteado, para poder recalcular cierres viejos.
catalogRouter.delete("/rules/:ruleId", requireAuth, requireAdmin, async (req, res) => {
  const rule = await endRuleVersion(req.params.ruleId);
  if (!rule) return res.status(404).json({ error: "Regla no encontrada o ya terminada." });
  res.json(rule);
});

// Editar un agente ya creado (corregir nombre mal tipeado, sistema o supervisor) sin
// arriesgarse a chocar contra otro agente por nombre, como pasaría con el alta (upsert).
const agentEditSchema = z.object({
  name: z.string().min(2).optional(),
  defaultSystem: z.enum(["PREPAGO", "WIN_LOSE"]).optional(),
  supervisor: z.string().nullable().optional(),
  accountType: z.enum(ACCOUNT_TYPES).optional(),
  // ID del agente en la plataforma de origen (ej. "Agent ID" del reporte Suprema) — permite
  // que el importador lo reconozca aunque el nombre venga distinto. Se completa solo la
  // primera vez que matchea por nombre, pero también se puede corregir a mano acá.
  externalId: z.string().nullable().optional(),
  // Dar de baja: el agente deja de listarse como activo (no puede recibir cierres/movimientos
  // nuevos), pero su historial ya cargado queda intacto — nunca se borra nada.
  active: z.boolean().optional(),
  // Cuenta de socio (caso Juan): nombre de una cuenta en Cuentas de socios. Si se setea, el
  // cierre semanal de este agente deja de tocar balances y se rutea entero a esa cuenta.
  personKey: z.string().nullable().optional(),
  // Cuentas consolidadas para supervisores (30/09/2026) — ver src/db/schema.sql.
  usaCuentaConsolidada: z.boolean().optional(),
  modeloCuenta: z.enum(["PREPAGO", "WIN_LOSE"]).nullable().optional(),
  exigirAgenteEnMovimientos: z.boolean().optional(),
  consolidarCierres: z.boolean().optional(),
});
catalogRouter.patch("/agents/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = agentEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const agent = await updateAgent(req.params.id, {
      name: parsed.data.name,
      defaultSystem: parsed.data.defaultSystem,
      supervisor: parsed.data.supervisor === undefined ? undefined : parsed.data.supervisor?.trim() || null,
      accountType: parsed.data.accountType,
      externalId: parsed.data.externalId === undefined ? undefined : parsed.data.externalId?.trim() || null,
      active: parsed.data.active,
      personKey: parsed.data.personKey === undefined ? undefined : parsed.data.personKey?.trim() || null,
      usaCuentaConsolidada: parsed.data.usaCuentaConsolidada,
      modeloCuenta: parsed.data.modeloCuenta,
      exigirAgenteEnMovimientos: parsed.data.exigirAgenteEnMovimientos,
      consolidarCierres: parsed.data.consolidarCierres,
    });
    if (!agent) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(agent);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real (no "dar de baja") — solo funciona si el agente no tiene ningún rastro real
// (ver eliminarAgenteDefinitivo). Pensado para limpiar duplicados de prueba/auto-creados por
// error, nunca para un agente con historial real (ese se da de baja, no se borra).
catalogRouter.delete("/agents/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await eliminarAgenteDefinitivo(req.params.id);
    if (!r.found) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

