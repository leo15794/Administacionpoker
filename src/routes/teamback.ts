// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- rutas, sección TOTALMENTE APARTE del
// resto del sistema. Todo bajo /teamback, admin-only (mismo criterio que el resto de la app).
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { parseSupremaWorkbook } from "../engine/importSuprema.js";
import {
  getTbConfig,
  updateTbConfig,
  listTbPlayers,
  getTbPlayer,
  crearTbPlayer,
  actualizarTbPlayer,
  getArbolReferidos,
  previsualizarImportSemana,
  importarSemana,
  calcularYGuardarLiquidacionSemana,
  getLiquidacionesSemana,
  getSemanasDisponibles,
  getHistorialJugador,
  getLiquidacionIndividual,
  type ImportRow,
} from "../repo/teamback.js";

export const teambackRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

teambackRouter.get("/config", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getTbConfig());
});

const configSchema = z.object({
  pctBase: z.number().min(0).max(1),
  pctTier2: z.number().min(0).max(1),
  pctTier3: z.number().min(0).max(1),
  umbralVolumenTier2Usd: z.number().min(0),
  umbralVolumenTier3Usd: z.number().min(0),
  umbralReferidosTier2: z.number().int().min(0),
  umbralReferidosTier3: z.number().int().min(0),
  umbralReferidoActivoUsd: z.number().min(0),
  pctComisionReferido: z.number().min(0).max(1),
  aplicarUmbralAComision: z.boolean(),
  ventanaActividadSemanas: z.number().int().min(1),
});
teambackRouter.put("/config", requireAuth, requireAdmin, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await updateTbConfig(parsed.data));
});

// ---------------------------------------------------------------------------------------------
// Jugadores / árbol
// ---------------------------------------------------------------------------------------------

teambackRouter.get("/players", requireAuth, requireAdmin, async (req, res) => {
  const includeInactive = req.query.includeInactive !== "false";
  res.json(await listTbPlayers(includeInactive));
});

teambackRouter.get("/players/:id", requireAuth, requireAdmin, async (req, res) => {
  const player = await getTbPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador." });
  res.json(player);
});

const playerSchema = z.object({
  supremaPlayerId: z.string().min(1),
  name: z.string().min(1),
  fechaAlta: z.string().optional(),
  referidoPorId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
teambackRouter.post("/players", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = playerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await crearTbPlayer(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const playerUpdateSchema = playerSchema.partial().extend({ active: z.boolean().optional() });
teambackRouter.patch("/players/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = playerUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await actualizarTbPlayer(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

teambackRouter.get("/arbol", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getArbolReferidos());
});

// ---------------------------------------------------------------------------------------------
// Import semanal (mismo archivo crudo de Suprema que ya usa DigiPlayers -- acá se usa solo el
// rake por jugador, ignorando todo lo de agentes/clubes/rodeo).
// ---------------------------------------------------------------------------------------------

teambackRouter.post("/import/preview", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'file')." });
  try {
    const parsed = await parseSupremaWorkbook(req.file.buffer);
    const rows: ImportRow[] = [];
    for (const sheet of parsed.sheets) {
      for (const row of sheet.rows) {
        rows.push({ supremaPlayerId: row.playerId, supremaPlayerName: row.playerName, rake: row.rake });
      }
    }
    const resultado = await previsualizarImportSemana(rows);
    res.json({ ...resultado, hojasIgnoradas: parsed.hojasIgnoradas, totalFilas: rows.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo leer el archivo." });
  }
});

const importSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  rows: z.array(z.object({ supremaPlayerId: z.string(), supremaPlayerName: z.string(), rake: z.number() })),
  importSource: z.string().optional(),
});
teambackRouter.post("/import/aplicar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const resultado = await importarSemana(parsed.data.weekStart, parsed.data.weekEnd, parsed.data.rows, parsed.data.importSource);
    res.json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Liquidación semanal
// ---------------------------------------------------------------------------------------------

const calcularSchema = z.object({ weekStart: z.string(), weekEnd: z.string() });
teambackRouter.post("/liquidaciones/calcular", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = calcularSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const resultado = await calcularYGuardarLiquidacionSemana(parsed.data.weekStart, parsed.data.weekEnd);
    res.json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

teambackRouter.get("/liquidaciones/semana/:weekStart", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getLiquidacionesSemana(req.params.weekStart));
});

teambackRouter.get("/liquidaciones/semanas", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getSemanasDisponibles());
});

teambackRouter.get("/liquidaciones/jugador/:playerId", requireAuth, requireAdmin, async (req, res) => {
  res.json(await getHistorialJugador(req.params.playerId));
});

teambackRouter.get("/liquidaciones/individual/:playerId/:weekStart", requireAuth, requireAdmin, async (req, res) => {
  try {
    res.json(await getLiquidacionIndividual(req.params.playerId, req.params.weekStart));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});
