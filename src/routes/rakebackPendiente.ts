import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listRakebackPendiente, pagarPendiente, darDeBajaPendiente, eliminarPendiente } from "../repo/rakebackPendiente.js";

export const rakebackPendienteRouter = Router();

// Listado de rakeback pendiente activo (por agente+club+cierre) -- ver repo/rakebackPendiente.ts.
rakebackPendienteRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listRakebackPendiente());
});

const pagarSchema = z.object({
  pendienteId: z.string(),
  amount: z.number().positive(),
  medio: z.enum(["FICHAS", "USDT", "EFECTIVO", "ZELLE"]),
  custodian: z.string().optional(),
  notes: z.string().optional(),
});

// Paga (total o parcial) un rakeback pendiente -- FICHAS mueve el stock físico (movimiento
// CARGA), USDT/EFECTIVO/ZELLE es un pago financiero real que no lo toca (movimiento PAGO).
rakebackPendienteRouter.post("/pagar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = pagarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await pagarPendiente({
      pendienteId: parsed.data.pendienteId,
      amount: parsed.data.amount,
      medio: parsed.data.medio,
      custodian: parsed.data.custodian,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const bajaSchema = z.object({
  notes: z.string().optional(),
});

// Da de baja un rakeback pendiente sin pagarlo (se decide perdonarlo, o se cargó mal).
rakebackPendienteRouter.post("/:id/baja", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = bajaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await darDeBajaPendiente(req.params.id, parsed.data.notes, req.user?.email);
    res.json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real (ej. cargado de prueba) -- bloqueado si ya se pagó algo.
rakebackPendienteRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await eliminarPendiente(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
