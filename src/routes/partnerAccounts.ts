import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  listPartnerAccounts,
  crearCuenta,
  editarCuenta,
  eliminarCuenta,
  listPartnerEntries,
  crearMovimiento,
  editarMovimiento,
  eliminarMovimiento,
  getAgregadosSocios,
} from "../repo/partnerAccounts.js";

export const partnerAccountsRouter = Router();

partnerAccountsRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listPartnerAccounts());
});

partnerAccountsRouter.get("/agregados", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getAgregadosSocios());
});

const cuentaSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio."),
  description: z.string().optional(),
});

partnerAccountsRouter.post("/", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = cuentaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearCuenta(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const cuentaUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

partnerAccountsRouter.put("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = cuentaUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarCuenta(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real — la cuenta y todos sus movimientos. Control 100% pedido explícitamente.
partnerAccountsRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarCuenta(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Historial de movimientos — global o filtrado por cuenta (?accountId=...).
partnerAccountsRouter.get("/movimientos", requireAuth, requireAdmin, async (req, res) => {
  const accountId = typeof req.query.accountId === "string" && req.query.accountId ? req.query.accountId : undefined;
  res.json(await listPartnerEntries(accountId));
});

const CATEGORIES = ["COMPENSACION", "COMISION", "PAGO", "RETIRO", "GASTO", "AJUSTE", "OTRO"] as const;

const entrySchema = z.object({
  accountId: z.string(),
  category: z.enum(CATEGORIES),
  concept: z.string().min(1, "El concepto es obligatorio."),
  amount: z.number().refine((n) => n !== 0, "El monto no puede ser 0."),
  entryDate: z.string().optional(),
  notes: z.string().optional(),
});

partnerAccountsRouter.post("/movimientos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearMovimiento(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const entryUpdateSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  concept: z.string().min(1).optional(),
  amount: z.number().refine((n) => n !== 0, "El monto no puede ser 0.").optional(),
  entryDate: z.string().optional(),
  notes: z.string().optional(),
});

partnerAccountsRouter.put("/movimientos/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = entryUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarMovimiento(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real — control 100% pedido explícitamente por el usuario para este módulo.
partnerAccountsRouter.delete("/movimientos/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarMovimiento(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
