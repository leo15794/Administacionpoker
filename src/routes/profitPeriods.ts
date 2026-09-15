import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  listAjustesExtraordinarios,
  crearAjusteExtraordinario,
  editarAjusteExtraordinario,
  eliminarAjusteExtraordinario,
  listSemanasDisponibles,
  listPeriodos,
  getPeriodoDetalle,
  previewPeriodo,
  crearPeriodo,
  editarPeriodo,
  cerrarPeriodo,
  reabrirPeriodo,
  eliminarPeriodo,
} from "../repo/profitPeriods.js";

export const profitPeriodsRouter = Router();

// ---------- Ajustes extraordinarios ----------

profitPeriodsRouter.get("/ajustes", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAjustesExtraordinarios());
});

const ajusteSchema = z.object({
  occurredAt: z.string().optional(),
  tipo: z.string().min(1, "El tipo es obligatorio."),
  descripcion: z.string().min(1, "La descripción es obligatoria."),
  responsable: z.string().nullable().optional(),
  clubAgencia: z.string().nullable().optional(),
  montoOriginal: z.number().positive("El monto original tiene que ser mayor a 0."),
  absorbeDigiplayers: z.number().optional(),
  absorbeAgente: z.number().optional(),
  absorbeSupervisor: z.number().optional(),
  modoDistribucion: z.enum(["IGUAL_POR_PERIODO", "PERSONALIZADO"]).optional(),
  periodosTotales: z.number().int().min(1).optional(),
  afectadoTipo: z.string().nullable().optional(),
  afectadoNombre: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});

profitPeriodsRouter.post("/ajustes", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearAjusteExtraordinario(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const ajusteUpdateSchema = ajusteSchema.partial();

profitPeriodsRouter.put("/ajustes/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarAjusteExtraordinario(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

profitPeriodsRouter.delete("/ajustes/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarAjusteExtraordinario(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Períodos ----------

profitPeriodsRouter.get("/semanas-disponibles", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSemanasDisponibles());
});

profitPeriodsRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listPeriodos());
});

profitPeriodsRouter.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  const periodo = await getPeriodoDetalle(req.params.id);
  if (!periodo) return res.status(404).json({ error: "No se encontró ese período." });
  res.json(periodo);
});

const previewSchema = z.object({ weekStarts: z.array(z.string()).min(1, "Elegí al menos una semana.") });

profitPeriodsRouter.post("/preview", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await previewPeriodo(parsed.data.weekStarts));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const periodoSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio."),
  weekStarts: z.array(z.string()).min(1, "Elegí al menos una semana."),
});

profitPeriodsRouter.post("/", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = periodoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearPeriodo(parsed.data.name, parsed.data.weekStarts));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const periodoUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  weekStarts: z.array(z.string()).optional(),
});

profitPeriodsRouter.put("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = periodoUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarPeriodo(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

profitPeriodsRouter.post("/:id/cerrar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    res.json(await cerrarPeriodo(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

profitPeriodsRouter.post("/:id/reabrir", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    res.json(await reabrirPeriodo(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real — control 100%, igual que Cuentas de socios.
profitPeriodsRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    await eliminarPeriodo(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
