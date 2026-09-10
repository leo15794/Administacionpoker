import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listAdvancesConAgente, listAdvanceMovements, altaAdelanto, ajustarAdelanto, corregirAdelanto, eliminarAdelanto } from "../repo/advances.js";

export const advancesRouter = Router();

// Listado de adelantos activos (para la tabla principal de la pestaña).
advancesRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAdvancesConAgente());
});

// Historial de movimientos — global o filtrado por agente (?agentId=...).
advancesRouter.get("/historial", requireAuth, requireAdmin, async (req, res) => {
  const agentId = typeof req.query.agentId === "string" && req.query.agentId ? req.query.agentId : undefined;
  res.json(await listAdvanceMovements(agentId));
});

// Alta de un adelanto NUEVO e independiente — un agente puede tener varios a la vez, no hay
// "el" adelanto del agente (ver nota en repo/advances.ts).
const altaSchema = z.object({
  agentId: z.string(),
  amount: z.number().positive(),
  clubOrigenId: z.string().nullable().optional(),
  notes: z.string().optional(),
});

advancesRouter.post("/alta", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = altaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const advance = await altaAdelanto({
      agentId: parsed.data.agentId,
      amount: parsed.data.amount,
      clubOrigenId: parsed.data.clubOrigenId,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(201).json(advance);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Aumento/Reducción/Consumo/Baja sobre UN adelanto puntual (por id) — nunca sobre "el del
// agente", porque puede tener varios.
const ajusteSchema = z.object({
  advanceId: z.string(),
  type: z.enum(["AUMENTO", "REDUCCION", "CONSUMO", "BAJA"]),
  amount: z.number(),
  notes: z.string().optional(),
});

advancesRouter.post("/ajuste", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const amount = parsed.data.type === "BAJA" ? 0 : parsed.data.amount;
  if (parsed.data.type !== "BAJA" && amount <= 0) {
    return res.status(400).json({ error: "El monto tiene que ser mayor a 0." });
  }
  try {
    const advance = await ajustarAdelanto({
      advanceId: parsed.data.advanceId,
      type: parsed.data.type,
      amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(201).json(advance);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Corrección de un error de carga (monto/consumido/club de origen mal tipeados) — distinto de
// /ajuste: no representa un evento real de negocio, solo arregla el dato. Igual queda en el
// historial (tipo CORRECCION) para no perder trazabilidad.
const correccionSchema = z.object({
  advanceId: z.string(),
  amount: z.number().min(0).optional(),
  consumed: z.number().min(0).optional(),
  clubOrigenId: z.string().nullable().optional(),
  notes: z.string().optional(),
});

advancesRouter.post("/correccion", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = correccionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const advance = await corregirAdelanto({
      advanceId: parsed.data.advanceId,
      amount: parsed.data.amount,
      consumed: parsed.data.consumed,
      clubOrigenId: parsed.data.clubOrigenId,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(advance);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real — a diferencia de "Baja" (que lo desactiva y deja el historial), esto lo saca
// del todo junto con sus movimientos. Para cuando el adelanto nunca debió cargarse.
advancesRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarAdelanto(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
