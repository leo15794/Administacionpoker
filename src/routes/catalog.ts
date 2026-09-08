import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { upsertAgent, upsertClub, upsertDeal, updateAgent, listAgents, listClubs, listDealsForAgent } from "../repo/catalog.js";

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
});
catalogRouter.post("/agents", requireAuth, requireAdmin, async (req, res) => {
  const parsed = agentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const agent = await upsertAgent(parsed.data.name, parsed.data.defaultSystem, parsed.data.supervisor ?? null);
    res.status(201).json(agent);
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

// Editar un agente ya creado (corregir nombre mal tipeado, sistema o supervisor) sin
// arriesgarse a chocar contra otro agente por nombre, como pasaría con el alta (upsert).
const agentEditSchema = z.object({
  name: z.string().min(2).optional(),
  defaultSystem: z.enum(["PREPAGO", "WIN_LOSE"]).optional(),
  supervisor: z.string().nullable().optional(),
});
catalogRouter.patch("/agents/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = agentEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const agent = await updateAgent(req.params.id, {
      name: parsed.data.name,
      defaultSystem: parsed.data.defaultSystem,
      supervisor: parsed.data.supervisor === undefined ? undefined : parsed.data.supervisor?.trim() || null,
    });
    if (!agent) return res.status(404).json({ error: "Agente no encontrado" });
    res.json(agent);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
