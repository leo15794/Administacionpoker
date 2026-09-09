import { Router } from "express";
import { z } from "zod";
import { registrarMovimiento, revertirMovimiento } from "../repo/ledger.js";
import { aplicarCierreSemanal, revertirCierreSemanal, eliminarCierreSemanalDefinitivo } from "../repo/closings.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";

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
  // "Rodeo" (solo SupremaPoker): nunca se confía un monto ya calculado del cliente — siempre
  // se manda el detalle CRUDO por jugador (Player ID + rodeo base de esa semana) y el servidor
  // recalcula la memoria y el reparto (30% App / 35% Unión / 20% Club / 15% Agente si tiene
  // agente asignado, o 35% Club si no) DENTRO de la transacción del cierre, igual que la
  // memoria de bancados. Nunca se pasa el % ya resuelto porque depende de la memoria previa
  // de CADA jugador, que solo la base conoce (rodeo_player_memory).
  rodeoJugadores: z
    .array(z.object({ playerExternalId: z.string().min(1), baseRodeo: z.number() }))
    .optional(),
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

// Vista previa: corre EXACTAMENTE la misma lógica (idempotencia, reglas especiales, supervisor,
// memoria de bancado) pero nunca escribe nada (aplicarCierreSemanal hace ROLLBACK al final si
// preview=true). Así el formulario puede mostrar el número real y bloquear antes de aplicar,
// sin arriesgarse a que la vista previa muestre algo distinto de lo que después se aplicaría.
movementsRouter.post("/cierre-semanal/preview", requireAuth, requireAdmin, async (req, res) => {
  const parsed = closingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await aplicarCierreSemanal({ ...parsed.data, preview: true });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Revierte un cierre semanal cargado por error. LEDGER INMUTABLE: no lo borra — revierte su
// efecto en el saldo y marca REVERTIDO tanto el movimiento del ledger como la fila de
// weekly_closings (ver revertirCierreSemanal), dejando todo visible en el historial.
// Va antes de "/:id" para que "cierre-semanal" no se interprete como un id de movimiento.
movementsRouter.delete("/cierre-semanal/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo : undefined;
    const result = await revertirCierreSemanal(req.params.id, motivo, req.user?.email ?? null);
    if (!result.found) return res.status(404).json({ error: "Cierre no encontrado" });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// BORRADO REAL (no revierte, elimina) — SOLO para limpiar datos de prueba mientras se prueba
// el sistema (pedido explícito del usuario). Nunca usar sobre un cierre de plata real ya
// operada: para eso siempre el DELETE de arriba ("Revertir"), que mantiene el ledger auditable.
// Ver eliminarCierreSemanalDefinitivo para el detalle de qué hace en cada caso.
movementsRouter.delete("/cierre-semanal/:id/definitivo", requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await eliminarCierreSemanalDefinitivo(req.params.id);
    if (!result.found) return res.status(404).json({ error: "Cierre no encontrado" });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Revierte un movimiento cargado por error. LEDGER INMUTABLE: no lo borra — revierte el
// balance con un movimiento AJUSTE opuesto y marca el original como REVERTIDO (ver
// revertirMovimiento). Exclusivo de administrador.
movementsRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const motivo = typeof req.body?.motivo === "string" ? req.body.motivo : undefined;
    const result = await revertirMovimiento(req.params.id, motivo, req.user?.email ?? null);
    if (!result.found) return res.status(404).json({ error: "Movimiento no encontrado" });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
