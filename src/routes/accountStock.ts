import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  listAccountStock,
  crearOEditarStock,
  editarStock,
  eliminarStock,
  getStockConsolidado,
  getObligacionPrepago,
  getResumenStock,
  getDeudasConsolidadas,
} from "../repo/accountStock.js";

export const accountStockRouter = Router();

accountStockRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAccountStock());
});

accountStockRouter.get("/consolidado", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getStockConsolidado());
});

accountStockRouter.get("/obligacion-prepago", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getObligacionPrepago());
});

accountStockRouter.get("/resumen", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getResumenStock());
});

accountStockRouter.get("/deudas-consolidadas", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getDeudasConsolidadas());
});

const stockSchema = z.object({
  agentId: z.string(),
  clubId: z.string(),
  units: z.number(),
  rate: z.number().nullable().optional(),
  excluded: z.boolean().optional(),
  estado: z.string().optional(),
  fuente: z.string().optional(),
  observaciones: z.string().optional(),
  confirmadoEn: z.string().optional(),
});

// Crea o actualiza (una sola fila vigente por agente+club — cargar de nuevo pisa el valor).
accountStockRouter.post("/", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = stockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearOEditarStock(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const stockUpdateSchema = stockSchema.partial();

accountStockRouter.put("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = stockUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarStock(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real — control 100% pedido explícitamente por el usuario para este módulo.
accountStockRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarStock(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
