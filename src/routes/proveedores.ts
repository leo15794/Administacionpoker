import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listClubs, listAgents } from "../repo/catalog.js";
import {
  listProveedores,
  crearProveedor,
  actualizarProveedor,
  listSaldosProveedores,
  aplicarCierreProveedor,
  revertirCierreProveedor,
  recalcularCierreProveedor,
  listCierresProveedor,
  listLineasCierreProveedor,
  obtenerCierreAgentePreview,
  registrarPagoProveedor,
  revertirPagoProveedor,
  listPagosProveedor,
  listGarantiasProveedores,
  listGarantiaProveedorMovements,
  ajustarGarantiaProveedor,
  eliminarCierreProveedorDefinitivo,
  eliminarPagoProveedorDefinitivo,
  eliminarGarantiaProveedorDefinitivo,
  eliminarProveedorDefinitivo,
  calcularLineaClubPreview,
  listAutoCierreClubesProveedor,
  listAutoCierreClubesTodos,
  agregarAutoCierreClub,
  eliminarAutoCierreClub,
} from "../repo/proveedores.js";

export const proveedoresRouter = Router();

proveedoresRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  const includeInactive = req.query.includeInactive === "1";
  res.json(await listProveedores(includeInactive));
});

const crearSchema = z.object({
  name: z.string().min(1),
  notes: z.string().optional(),
  autoCierreClubId: z.string().nullable().optional(),
  autoCierreRakebackPct: z.number().nullable().optional(),
});
proveedoresRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res
      .status(201)
      .json(
        await crearProveedor(parsed.data.name, parsed.data.notes, parsed.data.autoCierreClubId, parsed.data.autoCierreRakebackPct)
      );
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const actualizarSchema = z.object({
  name: z.string().optional(),
  notes: z.string().nullable().optional(),
  active: z.boolean().optional(),
  autoCierreClubId: z.string().nullable().optional(),
  autoCierreRakebackPct: z.number().nullable().optional(),
});
proveedoresRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = actualizarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await actualizarProveedor(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real y en cascada (22/09/2026, pedido de Leo: "seguimos haciendo pruebas") -- saca
// el proveedor y todo su rastro (saldos, cierres, pagos, garantías). No se puede deshacer.
proveedoresRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await eliminarProveedorDefinitivo(req.params.id);
    if (!r.found) return res.status(404).json({ error: "Proveedor no encontrado." });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============ Config de auto-cierre multi-club (22/09/2026) ============
// Un proveedor puede tener cualquier cantidad de clubes configurados -- ej. Manzur necesita
// M CHOCO/Suprema Y Fénix GG a la vez, no uno solo (ver repo/proveedores.ts para el porqué).
proveedoresRouter.get("/auto-cierre-clubes", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAutoCierreClubesTodos());
});

proveedoresRouter.get("/:id/auto-cierre-clubes", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listAutoCierreClubesProveedor(req.params.id));
});

const autoCierreClubSchema = z.object({
  clubId: z.string().min(1),
  rakebackPct: z.number(),
});
proveedoresRouter.post("/:id/auto-cierre-clubes", requireAuth, requireAdmin, async (req, res) => {
  const parsed = autoCierreClubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await agregarAutoCierreClub(req.params.id, parsed.data.clubId, parsed.data.rakebackPct));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.delete("/auto-cierre-clubes/:configId", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await eliminarAutoCierreClub(req.params.configId));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

proveedoresRouter.get("/saldos", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSaldosProveedores());
});

const lineaCierreSchema = z.object({
  tipo: z.enum(["CLUB", "AGENTE"]),
  clubId: z.string(),
  rakebackPct: z.number().optional(),
  agentId: z.string().optional(),
  notes: z.string().optional(),
});
const cierreSchema = z.object({
  proveedorId: z.string(),
  weekStart: z.string(),
  lineas: z.array(lineaCierreSchema).min(1),
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

proveedoresRouter.get("/cierres/:id/lineas", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listLineasCierreProveedor(req.params.id));
});

// Preview de una línea tipo CLUB (resultado + rake×% + clubRebate + impactoRodeo) antes de
// confirmar -- misma función que usa aplicarCierreProveedor, así el número que se ve acá es
// exactamente el que se va a guardar.
proveedoresRouter.get("/cierre-club-preview", requireAuth, requireAdmin, async (req, res) => {
  const { clubId, weekStart, rakebackPct } = req.query;
  if (typeof clubId !== "string" || typeof weekStart !== "string" || typeof rakebackPct !== "string") {
    return res.status(400).json({ error: "Faltan parámetros (clubId, weekStart, rakebackPct)." });
  }
  const pct = Number(rakebackPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
    return res.status(400).json({ error: "rakebackPct inválido." });
  }
  try {
    res.json(await calcularLineaClubPreview(clubId, weekStart, pct));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Preview del cierre ya aplicado de un agente (para armar una línea tipo AGENTE antes de
// confirmar el cierre del proveedor) -- ver "Cierres semanales" en Proveedores.
proveedoresRouter.get("/cierre-agente-preview", requireAuth, requireAdmin, async (req, res) => {
  const { agentId, clubId, weekStart } = req.query;
  if (typeof agentId !== "string" || typeof clubId !== "string" || typeof weekStart !== "string") {
    return res.status(400).json({ error: "Faltan parámetros (agentId, clubId, weekStart)." });
  }
  res.json(await obtenerCierreAgentePreview(agentId, clubId, weekStart));
});

// Agentes: reutiliza el mismo catálogo de agentes (para armar líneas tipo AGENTE).
proveedoresRouter.get("/agentes", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listAgents());
});

proveedoresRouter.delete("/cierres/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await revertirCierreProveedor(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Recalcular (22/09/2026, pedido de Leo: "si un cierre ya esta realizado que se pueda
// recalcular... si no tengo que borrar todo y volver a hacerlo") -- revierte y vuelve a
// aplicar las mismas líneas con los datos actuales, en un solo paso.
proveedoresRouter.post("/cierres/:id/recalcular", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    res.json(await recalcularCierreProveedor(req.params.id, req.user?.email));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real (22/09/2026, pedido de Leo: "seguimos haciendo pruebas") -- a diferencia de
// Revertir (que deja la fila marcada REVERTIDO), esto la saca del todo del historial.
proveedoresRouter.delete("/cierres/:id/definitivo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await eliminarCierreProveedorDefinitivo(req.params.id);
    if (!r.found) return res.status(404).json({ error: "Cierre no encontrado." });
    res.json({ ok: true });
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

proveedoresRouter.delete("/pagos/:id/definitivo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await eliminarPagoProveedorDefinitivo(req.params.id);
    if (!r.found) return res.status(404).json({ error: "Pago no encontrado." });
    res.json({ ok: true });
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

// Borrado real de una garantía entera (22/09/2026, pedido de Leo) -- a diferencia de "Baja"
// (que la deja inactiva pero registrada), esto la saca del todo junto con su historial.
proveedoresRouter.delete("/garantias/:id/definitivo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await eliminarGarantiaProveedorDefinitivo(req.params.id);
    if (!r.found) return res.status(404).json({ error: "Garantía no encontrada." });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
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
