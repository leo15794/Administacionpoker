import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listClubs } from "../repo/catalog.js";
import {
  listProveedores,
  crearProveedor,
  actualizarProveedor,
  listSaldosProveedores,
  aplicarCierreProveedor,
  revertirCierreProveedor,
  listCierresProveedor,
  registrarPagoProveedor,
  revertirPagoProveedor,
  listPagosProveedor,
  listGarantiasProveedores,
  listGarantiaProveedorMovements,
  ajustarGarantiaProveedor,
} from "../repo/proveedores.js";

export const proveedoresRouter = Router();

proveedoresRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  const includeInactive = req.query.includeInactive === "1";
  res.json(await listProveedores(includeInactive));
});

const crearSchema = z.object({ name: z.string().min(1), notes: z.string().optional() });
proveedoresRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearProveedor(parsed.data.name, parsed.data.notes));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const actualizarSchema = z.object({ name: z.string().optional(), notes: z.string().nullable().optional(), active: z.boolean().optional() });
proveedoresRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = actualizarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await actualizarProveedor(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.get("/saldos", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSaldosProveedores());
});

const cierreSchema = z.object({
  proveedorId: z.string(),
  clubId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  resultadoTotal: z.number(),
  rakeTotal: z.number(),
  rakebackPct: z.number(),
  notes: z.string().optional(),
});
proveedoresRouter.post("/cierres", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = cierreSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await aplicarCierreProveedor({ ...parsed.data, createdBy: req.user?.email });
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.get("/cierres", requireAuth, requireAdmin, async (req, res) => {
  const proveedorId = typeof req.query.proveedorId === "string" && req.query.proveedorId ? req.query.proveedorId : undefined;
  res.json(await listCierresProveedor(proveedorId));
});

proveedoresRouter.delete("/cierres/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await revertirCierreProveedor(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const pagoSchema = z.object({
  proveedorId: z.string(),
  clubId: z.string(),
  amount: z.number(),
  medio: z.enum(["USDT", "EFECTIVO", "ZELLE", "OTRO"]),
  direction: z.enum(["PAGO", "COBRO"]),
  notes: z.string().optional(),
});
proveedoresRouter.post("/pagos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = pagoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await registrarPagoProveedor({ ...parsed.data, createdBy: req.user?.email });
    res.status(201).json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.get("/pagos", requireAuth, requireAdmin, async (req, res) => {
  const proveedorId = typeof req.query.proveedorId === "string" && req.query.proveedorId ? req.query.proveedorId : undefined;
  res.json(await listPagosProveedor(proveedorId));
});

proveedoresRouter.delete("/pagos/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await revertirPagoProveedor(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.get("/garantias", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listGarantiasProveedores());
});

proveedoresRouter.get("/garantias/historial", requireAuth, requireAdmin, async (req, res) => {
  const proveedorId = typeof req.query.proveedorId === "string" && req.query.proveedorId ? req.query.proveedorId : undefined;
  res.json(await listGarantiaProveedorMovements(proveedorId));
});

const ajusteGarantiaSchema = z.object({
  proveedorId: z.string(),
  type: z.enum(["ALTA", "AUMENTO", "REDUCCION", "CONSUMO", "BAJA"]),
  amount: z.number(),
  notes: z.string().optional(),
});
proveedoresRouter.post("/garantias/ajuste", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteGarantiaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const amount = parsed.data.type === "BAJA" ? 0 : parsed.data.amount;
  if (parsed.data.type !== "BAJA" && amount <= 0) {
    return res.status(400).json({ error: "El monto tiene que ser mayor a 0." });
  }
  try {
    const garantia = await ajustarGarantiaProveedor({
      proveedorId: parsed.data.proveedorId,
      type: parsed.data.type,
      amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(201).json(garantia);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Clubes: reutiliza el mismo catálogo de agentes (no hace falta duplicarlo).
proveedoresRouter.get("/clubes", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listClubs());
});
