import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
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
} from "../repo/catalog.js";

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

catalogRouter.get("/agents", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAgents());
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
  defaultRebatePct: z.number().min(0).max(1).optional(),
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
  rebatePct: z.number().min(0).max(1).default(0),
  notes: z.string().optional(),
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
      parsed.data.notes
    );
    res.status(201).json({ id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

catalogRouter.get("/agents/:id/deals", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listDealsForAgent(req.params.id));
});

// Motor de reglas configurable (reemplaza "if agente === 'Manzur'" por una tabla versionada).
catalogRouter.get("/agents/:id/rules", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listRulesForAgent(req.params.id));
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
    });
    if (!agent) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(agent);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
