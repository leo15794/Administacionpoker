import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listAdvancesConAgente, listAdvanceMovements, ajustarAdelanto } from "../repo/advances.js";

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

const ajusteSchema = z.object({
  agentId: z.string(),
  type: z.enum(["ALTA", "AUMENTO", "REDUCCION", "CONSUMO", "BAJA"]),
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
      agentId: parsed.data.agentId,
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
