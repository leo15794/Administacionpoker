import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { listRakebackPendiente, pagarPendiente, darDeBajaPendiente, eliminarPendiente, revertirPagoPendiente, saldarPendienteConCruce, compensarPendienteNegativo, vincularMovimientoExistente, crearRakebackPendienteManual } from "../repo/rakebackPendiente.js";

export const rakebackPendienteRouter = Router();

// Listado de rakeback pendiente activo (por agente+club+cierre) -- ver repo/rakebackPendiente.ts.
rakebackPendienteRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listRakebackPendiente());
});

const crearManualSchema = z.object({
  agentId: z.string(),
  clubId: z.string(),
  weekStart: z.string(),
  weekEnd: z.string(),
  amount: z.number().refine((n) => Math.abs(n) > 0.004, "El monto tiene que ser distinto de 0."),
  notes: z.string().optional(),
});

// Alta manual de un rakeback pendiente viejo que nunca se cargó en el sistema (06/10/2026,
// pedido de Leo) -- crea un cierre semanal "fantasma" (is_manual=true) como ancla, igual que un
// cierre real para todo lo demás que ya lee rakeback_pendiente (ver crearRakebackPendienteManual
// en repo/rakebackPendiente.ts).
rakebackPendienteRouter.post("/manual", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = crearManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await crearRakebackPendienteManual({
      agentId: parsed.data.agentId,
      clubId: parsed.data.clubId,
      weekStart: parsed.data.weekStart,
      weekEnd: parsed.data.weekEnd,
      amount: parsed.data.amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(201).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const pagarSchema = z.object({
  pendienteId: z.string(),
  amount: z.number().positive(),
  medio: z.enum(["FICHAS", "USDT", "EFECTIVO", "ZELLE"]),
  custodian: z.string().optional(),
  notes: z.string().optional(),
});

// Paga (total o parcial) un rakeback pendiente -- FICHAS mueve el stock físico (movimiento
// CARGA), USDT/EFECTIVO/ZELLE es un pago financiero real que no lo toca (movimiento PAGO).
rakebackPendienteRouter.post("/pagar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = pagarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await pagarPendiente({
      pendienteId: parsed.data.pendienteId,
      amount: parsed.data.amount,
      medio: parsed.data.medio,
      custodian: parsed.data.custodian,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const saldarCruceSchema = z.object({
  pendienteId: z.string(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});

// Salda (total o parcial) un rakeback pendiente cruzándolo contra un adelanto ya dado -- no
// genera movimiento de ledger/tesorería nuevo (ver repo/rakebackPendiente.ts). Se llama desde
// Liquidaciones.tsx en el mismo momento en que se cruza el adelanto.
rakebackPendienteRouter.post("/saldar-cruce", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = saldarCruceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await saldarPendienteConCruce({
      pendienteId: parsed.data.pendienteId,
      amount: parsed.data.amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const compensarNegativoSchema = z.object({
  pendienteId: z.string(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});

// Salda (total o parcial) un rakeback pendiente NEGATIVO compensándolo contra el resto de la
// misma liquidación -- no genera movimiento de ledger/tesorería nuevo (ver
// compensarPendienteNegativo en repo/rakebackPendiente.ts). Caso real 05/10/2026: agente con un
// club en positivo y otro en negativo en la misma semana -- la deuda del club negativo se
// cancela con el sobrante del club positivo, en vez de pagarla/perdonarla aparte.
rakebackPendienteRouter.post("/compensar-negativo", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = compensarNegativoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await compensarPendienteNegativo({
      pendienteId: parsed.data.pendienteId,
      amount: parsed.data.amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const vincularSchema = z.object({
  pendienteId: z.string(),
  movementId: z.string(),
  amount: z.number().positive(),
  notes: z.string().optional(),
});

// Liga un movimiento de ledger YA EXISTENTE (Carga/Pago/Cobro cargado directo en Movimientos)
// contra un rakeback pendiente -- sin crear movimiento nuevo (ver vincularMovimientoExistente
// en repo/rakebackPendiente.ts). Caso real 05/10/2026: un Cobro cargado por afuera de
// Liquidaciones que en los hechos ya saldaba una deuda, pero el pendiente no se entera solo.
rakebackPendienteRouter.post("/vincular-movimiento", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = vincularSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await vincularMovimientoExistente({
      pendienteId: parsed.data.pendienteId,
      movementId: parsed.data.movementId,
      amount: parsed.data.amount,
      notes: parsed.data.notes,
      createdBy: req.user?.email,
    });
    res.status(200).json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const bajaSchema = z.object({
  notes: z.string().optional(),
});

// Da de baja un rakeback pendiente sin pagarlo (se decide perdonarlo, o se cargó mal).
rakebackPendienteRouter.post("/:id/baja", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = bajaSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const pendiente = await darDeBajaPendiente(req.params.id, parsed.data.notes, req.user?.email);
    res.json(pendiente);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Borrado real (ej. cargado de prueba) -- bloqueado si ya se pagó algo.
rakebackPendienteRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await eliminarPendiente(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Revierte/borra UN pago puntual (PAGO_FICHAS/PAGO_USDT) ya aplicado -- para corregir pagos
// mal cargados o, como en el caso real del 28/09/2026, un pago que quedó "huérfano" (su
// movimiento de ledger ya se había borrado antes por otro lado, así que acá solo queda
// deshacer el registro del pago en sí -- ver revertirPagoPendiente, que ya contempla que
// movement_id puede venir null). Mismo criterio de orden que el resto: solo el más reciente de
// ese pendiente puntual.
rakebackPendienteRouter.delete("/movimientos/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await revertirPagoPendiente(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
