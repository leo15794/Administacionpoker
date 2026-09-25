// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- rutas, sección TOTALMENTE APARTE del
// resto del sistema. Todo bajo /teamback.
// (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y contraseña para esta seccion")
// -- login PROPIO (lib/tbAuth.ts), nada que ver con requireAuth/requireAdmin del resto de la
// app (lib/auth.ts) -- un token de acá no sirve allá, y viceversa. Rutas de administración
// (config, jugadores, import, calcular liquidaciones) exigen requireTbAdmin; el portal de un
// jugador (ver el final del archivo) exige requireTbPlayer y siempre está scopeado a su PROPIO
// player_id (req.tbUser.playerId), nunca a uno elegido por el cliente.
import { Router } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireTbAuth, requireTbAdmin, requireTbPlayer } from "../lib/tbAuth.js";
import { parseSupremaWorkbook } from "../engine/importSuprema.js";
import {
  getTbConfig,
  updateTbConfig,
  getTbPlayerConfig,
  upsertTbPlayerConfig,
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
  getHistorialJugadorConNombre,
  getLiquidacionIndividual,
  listTbUsers,
  crearTbUser,
  actualizarTbUser,
  type ImportRow,
} from "../repo/teamback.js";

export const teambackRouter = Router();

function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

teambackRouter.get("/config", requireTbAuth, requireTbAdmin, async (_req, res) => {
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
teambackRouter.put("/config", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await updateTbConfig(parsed.data));
});

// ---------------------------------------------------------------------------------------------
// Jugadores / árbol
// ---------------------------------------------------------------------------------------------

// Config POR JUGADOR (25/09/2026) -- lo que realmente usa el motor de liquidación, ver
// repo/teamback.ts. GET devuelve null si el jugador todavía no tiene la suya cargada (la UI usa
// /config de arriba como plantilla para prellenar el formulario en ese caso).
teambackRouter.get("/players/:id/config", requireTbAuth, requireTbAdmin, async (req, res) => {
  const player = await getTbPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: "No se encontró ese jugador." });
  res.json(await getTbPlayerConfig(req.params.id));
});

teambackRouter.put("/players/:id/config", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await upsertTbPlayerConfig(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

teambackRouter.get("/players", requireTbAuth, requireTbAdmin, async (req, res) => {
  const includeInactive = req.query.includeInactive !== "false";
  res.json(await listTbPlayers(includeInactive));
});

teambackRouter.get("/players/:id", requireTbAuth, requireTbAdmin, async (req, res) => {
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
teambackRouter.post("/players", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = playerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await crearTbPlayer(parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const playerUpdateSchema = playerSchema.partial().extend({ active: z.boolean().optional() });
teambackRouter.patch("/players/:id", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = playerUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await actualizarTbPlayer(req.params.id, parsed.data));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

teambackRouter.get("/arbol", requireTbAuth, requireTbAdmin, async (_req, res) => {
  res.json(await getArbolReferidos());
});

// ---------------------------------------------------------------------------------------------
// Import semanal (mismo archivo crudo de Suprema que ya usa DigiPlayers -- acá se usa solo el
// rake por jugador, ignorando todo lo de agentes/clubes/rodeo).
// ---------------------------------------------------------------------------------------------

teambackRouter.post("/import/preview", requireTbAuth, requireTbAdmin, upload.single("file"), async (req, res) => {
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
teambackRouter.post("/import/aplicar", requireTbAuth, requireTbAdmin, async (req, res) => {
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
teambackRouter.post("/liquidaciones/calcular", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = calcularSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const resultado = await calcularYGuardarLiquidacionSemana(parsed.data.weekStart, parsed.data.weekEnd);
    res.json(resultado);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

teambackRouter.get("/liquidaciones/semana/:weekStart", requireTbAuth, requireTbAdmin, async (req, res) => {
  res.json(await getLiquidacionesSemana(req.params.weekStart));
});

teambackRouter.get("/liquidaciones/semanas", requireTbAuth, requireTbAdmin, async (_req, res) => {
  res.json(await getSemanasDisponibles());
});

teambackRouter.get("/liquidaciones/jugador/:playerId", requireTbAuth, requireTbAdmin, async (req, res) => {
  res.json(await getHistorialJugador(req.params.playerId));
});

teambackRouter.get("/liquidaciones/individual/:playerId/:weekStart", requireTbAuth, requireTbAdmin, async (req, res) => {
  try {
    res.json(await getLiquidacionIndividual(req.params.playerId, req.params.weekStart));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Usuarios de la sección (25/09/2026) -- login propio, ver tb_users en schema.sql y lib/tbAuth.ts.
// Solo un ADMIN ya logueado en esta sección puede crear o administrar otros usuarios (mismo
// patrón que /auth/bootstrap-user del resto de la app).
// ---------------------------------------------------------------------------------------------

teambackRouter.get("/usuarios", requireTbAuth, requireTbAdmin, async (_req, res) => {
  res.json(await listTbUsers());
});

// (25/09/2026, pedido de Leo: "no sea obligacion el email, puede ser usuario y contraseña") --
// username es cualquier texto (sin formato de email obligatorio), no un email.
const userSchema = z.object({
  role: z.enum(["ADMIN", "PLAYER"]),
  username: z.string().min(1),
  password: z.string().min(6, "La contraseña tiene que tener al menos 6 caracteres."),
  name: z.string().min(1),
  playerId: z.string().nullable().optional(),
});
teambackRouter.post("/usuarios", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await crearTbUser(parsed.data, hashPassword));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const userUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6, "La contraseña tiene que tener al menos 6 caracteres.").optional(),
});
teambackRouter.patch("/usuarios/:id", requireTbAuth, requireTbAdmin, async (req, res) => {
  const parsed = userUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await actualizarTbUser(req.params.id, parsed.data, hashPassword));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Portal del jugador (25/09/2026) -- autoservicio, SOLO lectura de su propia liquidación. Nunca
// recibe un playerId del cliente -- siempre usa req.tbUser.playerId (el que vino firmado en su
// propio token), así no hay forma de que un jugador vea la liquidación de otro.
// ---------------------------------------------------------------------------------------------

teambackRouter.get("/portal/mi-cuenta", requireTbAuth, requireTbPlayer, async (req: any, res) => {
  const player = await getTbPlayer(req.tbUser.playerId);
  if (!player) return res.status(404).json({ error: "No se encontró tu jugador." });
  res.json(player);
});

teambackRouter.get("/portal/historial", requireTbAuth, requireTbPlayer, async (req: any, res) => {
  res.json(await getHistorialJugadorConNombre(req.tbUser.playerId));
});
