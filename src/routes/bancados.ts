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

bancadosRouter.get("/historial", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listHistorialBancadoGlobal());
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
