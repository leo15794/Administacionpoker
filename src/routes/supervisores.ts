import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  listSupervisoresConsolidados,
  getSupervisorConCuenta,
  listSubordinados,
  registrarMovimientoSupervisor,
  listMovimientosSupervisor,
  revertirMovimientoSupervisor,
  migrarSaldoHistoricoSupervisor,
  listMigracionHistorica,
} from "../repo/supervisores.js";

export const supervisoresRouter = Router();

supervisoresRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listSupervisoresConsolidados());
});

supervisoresRouter.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  const s = await getSupervisorConCuenta(req.params.id);
  if (!s) return res.status(404).json({ error: "Supervisor no encontrado" });
  res.json(s);
});

supervisoresRouter.get("/:id/subordinados", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listSubordinados(req.params.id));
});

supervisoresRouter.get("/:id/movimientos", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listMovimientosSupervisor(req.params.id));
});

const movimientoSchema = z.object({
  clubId: z.string(),
  agentId: z.string().nullable().optional(),
  type: z.enum(["CARGA", "DESCARGA", "AJUSTE"]),
  amount: z.number(),
  campoAjuste: z.enum(["FICHAS", "CUENTA_CORRIENTE"]).optional(),
  usdtReal: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
supervisoresRouter.post("/:id/movimientos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = movimientoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await registrarMovimientoSupervisor({
      supervisorAgentId: req.params.id,
      ...parsed.data,
      createdBy: req.user?.email,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

supervisoresRouter.post("/movimientos/:movId/revertir", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await revertirMovimientoSupervisor(req.params.movId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

supervisoresRouter.get("/:id/migracion-historica", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listMigracionHistorica(req.params.id));
});

const migracionSchema = z.object({
  lineas: z.array(z.object({
    agentId: z.string(),
    clubId: z.string().nullable().optional(),
    fichasMigradas: z.number(),
    pendienteMigrado: z.number(),
    notes: z.string().nullable().optional(),
  })).min(1),
});
supervisoresRouter.post("/:id/migracion-historica", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = migracionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await migrarSaldoHistoricoSupervisor(req.params.id, parsed.data.lineas, req.user?.email);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
