import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  getBancadoConfig,
  upsertBancadoConfig,
  getEstadoBancado,
  getResumenBancado,
  previsualizarCierreBancado,
  cerrarCierreBancado,
  listHistorialBancado,
  listHistorialBancadoGlobal,
  revertirCierreBancado,
  eliminarCierreBancadoDefinitivo,
  registrarRecargaCapital,
  pagarCierreBancado,
  listResumenBancados,
} from "../repo/bancados.js";

export const bancadosRouter = Router();

bancadosRouter.get("/config/:playerId", requireAuth, requireAdmin, async (req, res) => {
  const config = await getBancadoConfig(req.params.playerId);
  if (!config) return res.status(404).json({ error: "Este jugador todavía no tiene configurada la banca." });
  res.json(config);
});

const configSchema = z.object({
  pctJugador: z.number().min(0).max(1),
  pctBanca: z.number().min(0).max(1),
  rakebackPct: z.number().min(0).max(1),
  capitalInicial: z.number(),
  makeupInicial: z.number().min(0),
  moneda: z.string().optional(),
  regla: z.string().optional(),
  observaciones: z.string().optional(),
  recuperacionMakeup: z.string().optional(),
});
bancadosRouter.put("/config/:playerId", requireAuth, requireAdmin, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const config = await upsertBancadoConfig(req.params.playerId, parsed.data);
  res.json(config);
});

bancadosRouter.get("/estado/:playerId", requireAuth, requireAdmin, async (req, res) => {
  const config = await getBancadoConfig(req.params.playerId);
  if (!config) return res.status(404).json({ error: "Este jugador todavía no tiene configurada la banca." });
  const estado = await getEstadoBancado(req.params.playerId, {
    pctJugador: Number(config.pct_jugador),
    pctBanca: Number(config.pct_banca),
    rakebackPct: Number(config.rakeback_pct),
    capitalInicial: Number(config.capital_inicial),
    makeupInicial: Number(config.makeup_inicial),
  });
  const resumen = await getResumenBancado(req.params.playerId);
  res.json({ config, estado, resumen });
});

const origenSchema = z.object({
  playerId: z.string().min(1),
  resultadoMesas: z.number(),
  rakeTotal: z.number(),
});
bancadosRouter.post("/previsualizar", requireAuth, requireAdmin, async (req, res) => {
  const parsed = origenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await previsualizarCierreBancado(parsed.data.playerId, {
      resultadoMesas: parsed.data.resultadoMesas,
      rakeTotal: parsed.data.rakeTotal,
    });
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const cerrarSchema = z.object({
  playerId: z.string().min(1),
  weekStart: z.string(),
  weekEnd: z.string(),
  resultadoMesas: z.number(),
  rakeTotal: z.number(),
  observaciones: z.string().optional(),
});
bancadosRouter.post("/cerrar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = cerrarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await cerrarCierreBancado({ ...parsed.data, createdBy: req.user?.email ?? null });
    res.status(r.alreadyApplied ? 200 : 201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const recargaSchema = z.object({
  playerId: z.string().min(1),
  monto: z.number().refine((n) => n !== 0, "El monto no puede ser 0."),
  fecha: z.string().min(1),
  observaciones: z.string().optional(),
});
// Recarga/ajuste manual de capital — para cuando el jugador se queda en 0 (o negativo) a mitad
// de camino y hay que volver a cargarle fichas; antes solo se podía setear una vez, al crear la
// config (ver registrarRecargaCapital). No toca rake/rakeback/makeup, solo el capital.
bancadosRouter.post("/recargar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = recargaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const r = await registrarRecargaCapital({ ...parsed.data, createdBy: req.user?.email ?? null });
    res.status(201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

bancadosRouter.get("/historial", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listHistorialBancadoGlobal());
});

// Resumen histórico: una fila por jugador bancado, con el acumulado de todos sus cierres
// semanales (ganancia jugador vs. ganancia empresa) — para ver el desglose global sin tener
// que abrir cada jugador uno por uno.
bancadosRouter.get("/resumen", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listResumenBancados());
});

bancadosRouter.get("/historial/:playerId", requireAuth, requireAdmin, async (req, res) => {
  res.json(await listHistorialBancado(req.params.playerId));
});

bancadosRouter.delete("/historial/:id", requireAuth, requireAdmin, async (req, res) => {
  const motivo = typeof req.body?.motivo === "string" ? req.body.motivo : undefined;
  const r = await revertirCierreBancado(req.params.id, motivo);
  if (!r.found) return res.status(404).json({ error: "Cierre de banca no encontrado (o ya estaba revertido)." });
  res.json(r);
});

// BORRADO REAL — solo para limpiar datos de prueba, nunca sobre plata real ya operada (ver
// eliminarCierreBancadoDefinitivo). Va con un segmento más ("/definitivo") para no chocar con
// el revertir de arriba.
bancadosRouter.delete("/historial/:id/definitivo", requireAuth, requireAdmin, async (req, res) => {
  const r = await eliminarCierreBancadoDefinitivo(req.params.id);
  if (!r.found) return res.status(404).json({ error: "Cierre de banca no encontrado." });
  res.json(r);
});

// Botón "Pagar": registra en Wallet (WALLET_MANOS, EGRESO) el pago de este cierre semanal —
// ver pagarCierreBancado para el detalle e idempotencia.
bancadosRouter.post("/historial/:id/pagar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const r = await pagarCierreBancado(req.params.id, req.user?.email ?? null);
    res.status(r.alreadyPaid ? 200 : 201).json(r);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
