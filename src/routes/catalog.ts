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
} from "../repo/catalog.js";
import { listBalancesByAgent, listMovementsByAgent } from "../repo/ledger.js";
import { listCargasPendientesPorAgentes, consumirCarga, eliminarCarga } from "../repo/cargaCruces.js";
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
  const adelantos = await pool.query(
    `SELECT * FROM rakeback_advances WHERE agent_id = $1 AND active = true ORDER BY created_at DESC`,
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
  const r = await pool.query(
    `SELECT DISTINCT week_start, week_end FROM weekly_closings
     WHERE agent_id = ANY($1::text[]) AND status <> 'REVERTIDO'
     ORDER BY week_start DESC LIMIT 52`,
    [agentIds]
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

  const agentes = await pool.query(`SELECT id, name FROM agents WHERE id = ANY($1::text[])`, [agentIds]);
  if (agentes.rows.length === 0) return res.status(404).json({ error: "Agente no encontrado" });

  const closings = await pool.query(
    `SELECT wc.*, c.name as club_name, a.name as agent_name FROM weekly_closings wc
     JOIN clubs c ON c.id = wc.club_id
     JOIN agents a ON a.id = wc.agent_id
     WHERE wc.agent_id = ANY($1::text[]) AND wc.week_start = $2 AND wc.status <> 'REVERTIDO'
     ORDER BY c.name`,
    [agentIds, weekStart]
  );
  if (closings.rows.length === 0) return res.status(404).json({ error: "No hay cierres para esa semana." });

  const adelantos = await pool.query(
    `SELECT ra.id, ra.amount, ra.consumed, a.name as agent_name, c.name as club_origen_name
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
  const closingIds = closings.rows.map((c) => c.id);
  const pendientesRes = await pool.query(
    `SELECT * FROM rakeback_pendiente WHERE weekly_closing_id = ANY($1::text[]) AND role = 'AGENTE' AND active = true AND amount > consumed`,
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
      rakebackPendienteDisponible: pendiente ? Number(pendiente.amount) - Number(pendiente.consumed) : null,
    };
  });
  const total = filas.reduce((s, f) => s + f.rakebackNeto, 0);

  res.json({
    agentes: agentes.rows,
    weekStart: closings.rows[0].week_start,
    weekEnd: closings.rows[0].week_end,
    filas,
    total,
    adelantos: adelantos.rows.map((a) => ({
      id: a.id,
      agentName: a.agent_name,
      clubOrigenName: a.club_origen_name,
      amount: Number(a.amount),
      consumed: Number(a.consumed),
      pendiente: Number(a.amount) - Number(a.consumed),
    })),
    cargas: cargasPendientes.map((cp) => ({
      id: cp.id,
      agentName: cp.agent_name,
      clubName: cp.club_name,
      amount: Number(cp.amount),
      consumed: Number(cp.consumed),
      pendiente: Number(cp.amount) - Number(cp.consumed),
    })),
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
});

catalogRouter.post("/liquidacion/guardar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = guardarLiquidacionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const r = await pool.query(
    `INSERT INTO liquidaciones_guardadas
       (id, nombre_grupo, agent_ids, week_start, week_end, filas, total, adelantos_aplicados, adelantos_manual, cargas_aplicadas, total_a_pagar, nota, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
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
    ]
  );
  res.status(201).json(r.rows[0]);
});

// Historial de liquidaciones guardadas — más reciente primero.
catalogRouter.get("/liquidacion/historial", requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query(`SELECT * FROM liquidaciones_guardadas ORDER BY created_at DESC LIMIT 200`);
  res.json(r.rows);
});

// Borrado real — para limpiar liquidaciones de PRUEBA. No afecta ningún adelanto ni cierre real
// (esto es solo la foto/reporte, ya guardada; los cruces de adelanto ya quedaron aplicados
// aparte y hay que deshacerlos, si corresponde, desde Adelantos).
catalogRouter.delete("/liquidacion/historial/:id", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(`DELETE FROM liquidaciones_guardadas WHERE id = $1 RETURNING id`, [req.params.id]);
  if (r.rowCount === 0) return res.status(404).json({ error: "No se encontró esa liquidación guardada." });
  res.json({ ok: true });
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

