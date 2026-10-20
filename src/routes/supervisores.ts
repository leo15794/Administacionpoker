import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  listSupervisoresConsolidados,
  getSupervisorConCuenta,
  listSubordinados,
  registrarMovimientoSupervisor,
  listMovimientosSupervisor,
  revertirMovimientoSupervisor,
  migrarSaldoHistoricoSupervisor,
  listMigracionHistorica,
  previsualizarImportacionSaldos,
  importarSaldosSupervisor,
  listSaldosPorAgenteSupervisor,
  setOcultoSubordinado,
  getSemanasDisponiblesSupervisor,
  getCierreSemanalSupervisor,
  aplicarCierreConsolidadoSupervisor,
  revertirCierreConsolidadoSupervisor,
  listSolicitudesRetiroPendientesTodas,
  marcarSolicitudRetiroEnviada,
  rechazarSolicitudRetiro,
} from "../repo/supervisores.js";

export const supervisoresRouter = Router();

supervisoresRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listSupervisoresConsolidados());
});

supervisoresRouter.get("/:id", requireAuth, requireAdmin, async (req, res) => {
  const s = await getSupervisorConCuenta(req.params.id);
  if (!s) return res.status(404).json({ error: "Supervisor no encontrado" });
  res.json(s);
});

supervisoresRouter.get("/:id/subordinados", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listSubordinados(req.params.id));
});

supervisoresRouter.get("/:id/movimientos", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listMovimientosSupervisor(req.params.id));
});

const ocultarSchema = z.object({ ocultar: z.boolean() });
// Ocultar/mostrar un subordinado (01/10/2026, caso Uriel): mueve el pool de verdad, ver nota en
// repo/supervisores.ts setOcultoSubordinado -- reemplaza el intento anterior (puramente visual
// vía PATCH /agents/:id) que Leo pidió cambiar después de probarlo.
supervisoresRouter.post("/:id/agentes/:agentId/ocultar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = ocultarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await setOcultoSubordinado(req.params.id, req.params.agentId, parsed.data.ocultar, req.user?.email);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const movimientoSchema = z.object({
  clubId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  type: z.enum(["CARGA", "DESCARGA", "AJUSTE", "PAGO", "COBRO"]),
  amount: z.number(),
  campoAjuste: z.enum(["FICHAS", "CUENTA_CORRIENTE"]).optional(),
  usdtReal: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  // Link de pago/trackeo (16/10/2026, pedido de Leo) -- opcional, disponible en cualquier
  // Carga/Descarga manual, no solo las que vienen de resolver una solicitud (ver abajo).
  paymentLink: z.string().nullable().optional(),
});
supervisoresRouter.post("/:id/movimientos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = movimientoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await registrarMovimientoSupervisor({
      supervisorAgentId: req.params.id,
      ...parsed.data,
      createdBy: req.user?.email,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

supervisoresRouter.post("/movimientos/:movId/revertir", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await revertirMovimientoSupervisor(req.params.movId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

supervisoresRouter.get("/:id/migracion-historica", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listMigracionHistorica(req.params.id));
});

supervisoresRouter.get("/:id/saldos-por-agente", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await listSaldosPorAgenteSupervisor(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Importar saldos de los agentes a cargo (20/10/2026) -- ver repo/supervisores.ts importarSaldosSupervisor.
supervisoresRouter.get("/:id/importar-saldos", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await previsualizarImportacionSaldos(req.params.id));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
supervisoresRouter.post("/:id/importar-saldos", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = z.object({ agentIds: z.array(z.string()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(await importarSaldosSupervisor(req.params.id, parsed.data.agentIds, req.user?.email));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const migracionSchema = z.object({
  lineas: z.array(z.object({
    agentId: z.string(),
    clubId: z.string().nullable().optional(),
    fichasMigradas: z.number(),
    pendienteMigrado: z.number(),
    notes: z.string().nullable().optional(),
  })).min(1),
});
supervisoresRouter.post("/:id/migracion-historica", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = migracionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await migrarSaldoHistoricoSupervisor(req.params.id, parsed.data.lineas, req.user?.email);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Cierre semanal consolidado (14/10/2026, pedido de Leo) -- ver repo/supervisores.ts.
// ---------------------------------------------------------------------------------------------

supervisoresRouter.get("/:id/cierre-semanal/semanas", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getSemanasDisponiblesSupervisor(req.params.id));
});

supervisoresRouter.get("/:id/cierre-semanal/:weekStart", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getCierreSemanalSupervisor(req.params.id, req.params.weekStart));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const aplicarCierreSupervisorSchema = z.object({ weekStart: z.string(), weekEnd: z.string() });
supervisoresRouter.post("/:id/cierre-semanal/aplicar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = aplicarCierreSupervisorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await aplicarCierreConsolidadoSupervisor(
      req.params.id,
      parsed.data.weekStart,
      parsed.data.weekEnd,
      req.user?.email
    );
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const revertirCierreSupervisorSchema = z.object({ motivo: z.string().nullable().optional() });
supervisoresRouter.post("/cierre-semanal/:cierreId/revertir", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = revertirCierreSupervisorSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await revertirCierreConsolidadoSupervisor(req.params.cierreId, parsed.data.motivo ?? undefined);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Solicitudes de retiro/pago (16/10/2026, pedido de Leo) -- lado admin: listar las pendientes
// de CUALQUIER supervisor, marcar como enviada (dispara la Descarga de siempre con el link de
// pago) o rechazar. La creación es exclusiva del supervisor, ver routes/portal.ts.
// ---------------------------------------------------------------------------------------------

supervisoresRouter.get("/solicitudes-retiro", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSolicitudesRetiroPendientesTodas());
});

const marcarEnviadoSchema = z.object({
  clubId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  paymentLink: z.string().min(1, "Falta el link de pago."),
});
supervisoresRouter.post("/solicitudes-retiro/:id/marcar-enviado", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = marcarEnviadoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await marcarSolicitudRetiroEnviada(req.params.id, { ...parsed.data, createdBy: req.user?.email });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const rechazarSolicitudSchema = z.object({ motivo: z.string().nullable().optional() });
supervisoresRouter.post("/solicitudes-retiro/:id/rechazar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = rechazarSolicitudSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await rechazarSolicitudRetiro(req.params.id, parsed.data.motivo ?? null, req.user?.email);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
