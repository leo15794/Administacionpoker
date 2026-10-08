import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  crearContrato,
  editarContrato,
  eliminarContrato,
  listContratos,
  listCandidatosBancado,
  getContrato,
  listPeriodos,
  getPeriodo,
  abrirPeriodo,
  reabrirPeriodo,
  editarMemoriaInicial,
  registrarParcial,
  listParciales,
  eliminarParcial,
  getEstadoPeriodo,
  ejecutarSplitExtraordinario,
  ejecutarCierreMensual,
  registrarCierreRmf,
  listHistorialRmf,
  revertirCierreRmf,
  listLiquidaciones,
  crearAjuste,
  resolverAjuste,
  listAjustes,
  registrarCostoFijo,
  listCostosFijos,
} from "../repo/bancadoContratos.js";

export const bancadoContratosRouter = Router();

const contratoSchema = z.object({
  playerId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  clubId: z.string().nullable().optional(),
  moneda: z.string().optional(),
  reglaKey: z.enum(["RMF", "REGLA_BANCADO_V1"]),
  observaciones: z.string().nullable().optional(),
  rmfPctJugador: z.number().min(0).max(1).optional(),
  rmfPctBanca: z.number().min(0).max(1).optional(),
  rmfRakebackPct: z.number().min(0).max(1).optional(),
  rmfRakebackBancaPct: z.number().min(0).max(1).optional(),
  rmfUnionSharePct: z.number().min(0).max(1).optional(),
  rmfCapitalInicial: z.number().optional(),
  rmfMakeupInicial: z.number().min(0).optional(),
  v1RakeDealPct: z.number().min(0).max(1).optional(),
  v1RakeTeambackDirectoPct: z.number().min(0).max(1).optional(),
  v1SplitJugadorPct: z.number().min(0).max(1).optional(),
  v1SplitTeambackPct: z.number().min(0).max(1).optional(),
  v1ModoMemoriaDefault: z.enum(["AUTOMATICO", "PARCIAL_MANUAL"]).optional(),
});

bancadoContratosRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listContratos());
});

bancadoContratosRouter.get("/candidatos", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listCandidatosBancado());
});

bancadoContratosRouter.post("/", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = contratoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearContrato(parsed.data, req.user?.email ?? null));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  const contrato = await getContrato(req.params.id);
  if (!contrato) return res.status(404).json({ error: "Contrato no encontrado." });
  res.json(contrato);
});

const editarSchema = contratoSchema.partial().omit({ reglaKey: true, playerId: true, agentId: true });
bancadoContratosRouter.put("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = editarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarContrato(req.params.id, parsed.data, req.user?.email ?? null));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await eliminarContrato(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Períodos (REGLA_BANCADO_V1) ----
bancadoContratosRouter.get("/:id/periodos", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listPeriodos(req.params.id));
});

const abrirPeriodoSchema = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  memoriaInicial: z.number().min(0).optional(),
  modoMemoria: z.enum(["AUTOMATICO", "PARCIAL_MANUAL"]).optional(),
});
bancadoContratosRouter.post("/:id/periodos", requireAuth, requireAdmin, async (req, res) => {
  const parsed = abrirPeriodoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await abrirPeriodo({ contratoId: req.params.id, ...parsed.data }));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/periodos/:periodoId/estado", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getEstadoPeriodo(req.params.periodoId));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

const reabrirSchema = z.object({ motivo: z.string().min(1) });
bancadoContratosRouter.post("/periodos/:periodoId/reabrir", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = reabrirSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await reabrirPeriodo({ periodoId: req.params.periodoId, motivo: parsed.data.motivo, reabiertoPor: req.user?.email ?? "admin" }));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const editarMemoriaInicialSchema = z.object({ nuevoValor: z.number(), motivo: z.string().min(1) });
bancadoContratosRouter.post("/periodos/:periodoId/memoria-inicial", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = editarMemoriaInicialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await editarMemoriaInicial({
      periodoId: req.params.periodoId,
      nuevoValor: parsed.data.nuevoValor,
      motivo: parsed.data.motivo,
      usuario: req.user?.email ?? "admin",
    }));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Parciales semanales ----
const parcialSchema = z.object({
  desde: z.string().min(1),
  hasta: z.string().min(1),
  resultadoMesas: z.number(),
  rakeBruto: z.number(),
  ajuste: z.number().optional(),
  ajusteNota: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
});
bancadoContratosRouter.post("/periodos/:periodoId/parciales", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = parcialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await registrarParcial({ periodoId: req.params.periodoId, ...parsed.data }, req.user?.email ?? null));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/periodos/:periodoId/parciales", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listParciales(req.params.periodoId));
});

bancadoContratosRouter.delete("/parciales/:parcialId", requireAuth, requireAdmin, async (req, res) => {
  try {
    await eliminarParcial(req.params.parcialId);
    res.status(204).end();
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Split extraordinario ----
const extraordinarioSchema = z.object({
  gananciaDisponible: z.number().min(0).optional(),
  memoriaAplicada: z.number().min(0),
  motivo: z.string().min(1),
  observaciones: z.string().nullable().optional(),
  pagoReal: z.number().optional(),
});
bancadoContratosRouter.post("/periodos/:periodoId/split-extraordinario", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = extraordinarioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await ejecutarSplitExtraordinario(
      { periodoId: req.params.periodoId, ...parsed.data, autorizadoPor: req.user?.email ?? "admin" },
      req.user?.email ?? null
    );
    res.status(201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Cierre mensual ----
const cierreMensualSchema = z.object({
  modoMemoria: z.enum(["AUTOMATICO", "PARCIAL_MANUAL"]).optional(),
  memoriaAplicadaManual: z.number().min(0).optional(),
  pagoReal: z.number().optional(),
});
bancadoContratosRouter.post("/periodos/:periodoId/cerrar-mes", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = cierreMensualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await ejecutarCierreMensual(
      { periodoId: req.params.periodoId, ...parsed.data, autorizadoPor: req.user?.email ?? "admin" },
      req.user?.email ?? null
    );
    res.status(201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Regla RMF ----
const rmfSchema = z.object({
  desde: z.string().min(1),
  hasta: z.string().min(1),
  resultadoMesas: z.number(),
  rakeBruto: z.number(),
  ticketPromocional: z.number().optional(),
  ticketPromocionalNota: z.string().nullable().optional(),
  observaciones: z.string().nullable().optional(),
  pagoReal: z.number().optional(),
});
bancadoContratosRouter.post("/:id/cierre-rmf", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = rmfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await registrarCierreRmf({ contratoId: req.params.id, ...parsed.data }, req.user?.email ?? null);
    res.status(201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/:id/historial-rmf", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listHistorialRmf(req.params.id));
});

bancadoContratosRouter.delete("/historial-rmf/:cierreId", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo : undefined;
  try {
    res.json(await revertirCierreRmf(req.params.cierreId, motivo, req.user?.email ?? null));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Historiales ----
bancadoContratosRouter.get("/:id/liquidaciones", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listLiquidaciones(req.params.id, typeof req.query.periodoId === "string" ? req.query.periodoId : undefined));
});

// ---- Ajustes ----
const ajusteSchema = z.object({
  periodoId: z.string().nullable().optional(),
  tipo: z.enum(["CREDITO_JUGADOR", "DEBITO_JUGADOR", "AJUSTE_MEMORIA", "CORRECCION_CIERRE", "PAGO_PENDIENTE", "COMPENSACION", "ADMINISTRATIVO"]),
  importe: z.number().positive(),
  signo: z.enum(["POSITIVO", "NEGATIVO"]),
  fecha: z.string().optional(),
  motivo: z.string().min(1),
  observaciones: z.string().nullable().optional(),
});
bancadoContratosRouter.post("/:id/ajustes", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ajusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await crearAjuste({ contratoId: req.params.id, ...parsed.data, usuario: req.user?.email ?? "admin" }));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/:id/ajustes", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listAjustes(req.params.id));
});

const resolverAjusteSchema = z.object({ estado: z.enum(["APLICADO", "REVERTIDO"]) });
bancadoContratosRouter.post("/ajustes/:ajusteId/resolver", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = resolverAjusteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await resolverAjuste(req.params.ajusteId, req.user?.email ?? "admin", parsed.data.estado));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Costo fijo ----
const costoFijoSchema = z.object({
  anio: z.number().int(),
  mes: z.number().int().min(1).max(12),
  monto: z.number(),
  moneda: z.string().optional(),
  observaciones: z.string().nullable().optional(),
});
bancadoContratosRouter.post("/:id/costos-fijos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = costoFijoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await registrarCostoFijo({ contratoId: req.params.id, ...parsed.data }, req.user?.email ?? null));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadoContratosRouter.get("/:id/costos-fijos", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listCostosFijos(req.params.id));
});
