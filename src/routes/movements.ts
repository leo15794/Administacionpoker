import { Router } from "express";
import { z } from "zod";
import { registrarMovimiento, eliminarMovimiento } from "../repo/ledger.js";
import { aplicarCierreSemanal } from "../repo/closings.js";
import { requireAuth, requireAdmin } from "../lib/auth.js";

export const movementsRouter = Router();

const movementSchema = z.object({
  idempotencyKey: z.string().min(3),
  type: z.enum(["CARGA", "DESCARGA", "COBRO", "PAGO", "TRANSFERENCIA_ENTRE_CLUBES", "TICKET_PROMOCIONAL", "AJUSTE"]),
  clubId: z.string(),
  clubDestinoId: z.string().optional(),
  agentId: z.string(),
  amount: z.number(),
  originalAmount: z.number().optional(),
  originalUnit: z.string().optional(),
  paymentMethod: z.enum(["USDT", "EFECTIVO", "ZELLE", "SIN_TESORERIA", "OTRO"]).optional(),
  occurredAt: z.string(),
  observation: z.string().optional(),
  refs: z.array(z.string()).optional(),
  custodian: z.string().optional(),
});

// Único punto de entrada para registrar dinero/fichas moviéndose. Idempotente por diseño:
// reintentar la misma clave nunca duplica el efecto (regla central de la bitácora).
movementsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = movementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const result = await registrarMovimiento({
      ...parsed.data,
      occurredAt: new Date(parsed.data.occurredAt),
    });
    res.status(result.alreadyApplied ? 200 : 201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const closingSchema = z.object({
  agentId: z.string(),
  clubId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  system: z.enum(["PREPAGO", "WIN_LOSE"]),
  result: z.number(),
  rakeTotal: z.number(),
  rakebackPct: z.number(),
  rebatePct: z.number().default(0),
  rateSnapshot: z.number().optional(),
  observation: z.string().optional(),
});

movementsRouter.post("/cierre-semanal", requireAuth, requireAdmin, async (req, res) => {
  const parsed = closingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await aplicarCierreSemanal(parsed.data);
    res.status(result.alreadyApplied ? 200 : 201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Eliminar un movimiento cargado por error. Revierte el balance y borra su tesorería
// asociada (ver eliminarMovimiento). Exclusivo de administrador.
movementsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await eliminarMovimiento(req.params.id);
    if (!result.found) return res.status(404).json({ error: "Movimiento no encontrado" });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
