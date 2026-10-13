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
import { put as subirAVercelBlob } from "@vercel/blob";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireTbAuth, requireTbAdmin, requireTbPlayer } from "../lib/tbAuth.js";
import { parseSupremaWorkbook } from "../engine/importSuprema.js";
// (09/10/2026, pedido de Leo: "podemos poner en espejo la wallet de adm poker... en modo
// espejo") -- única excepción deliberada a "TeamBack Affiliates no importa nada del sistema
// principal": lee (nunca escribe) el saldo de la Wallet del sistema principal, para mostrarlo acá
// en modo SOLO LECTURA. Ver la ruta GET /wallet-espejo más abajo, admin-only.
import { getSaldoWalletNeto } from "../repo/treasury.js";
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
  eliminarSemana,
  getGananciaPorSemana,
  marcarLiquidacionPagada,
  marcarLiquidacionNoPagada,
  getHistorialJugador,
  getHistorialJugadorConNombre,
  getLiquidacionIndividual,
  listTbUsers,
  crearTbUser,
  actualizarTbUser,
  guardarPushSubscription,
  eliminarPushSubscription,
  getLogNotificaciones,
  notificarLiquidacionCerrada,
  notificarLiquidacionPagada,
  notificarReferidosActivos,
  enviarBroadcast,
  eliminarLogNotificacion,
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

// (25/09/2026, pedido de Leo: "botones para eliminar cierres de la semana ya que ahora estamos
// haciendo pruebas") -- borra la liquidación calculada Y el rake importado en crudo de esa
// semana, así se puede reimportar/recalcular desde cero. No es soft-delete: es DELETE real
// sobre tb_weekly_liquidations y tb_weekly_stats, scopeado a esa semana nada más.
teambackRouter.delete("/liquidaciones/semana/:weekStart", requireTbAuth, requireTbAdmin, async (req, res) => {
  try {
    res.json(await eliminarSemana(req.params.weekStart));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo eliminar la semana." });
  }
});

// ---------------------------------------------------------------------------------------------
// Ganancia por semana (25/09/2026, pedido de Leo) -- ver repo/teamback.ts getGananciaPorSemana.
// ---------------------------------------------------------------------------------------------

// (25/09/2026, arreglo: esta ruta se había quedado sin try/catch -- si la consulta fallaba, por
// ejemplo por una tabla que todavía no existía en producción, la promesa quedaba rechazada sin
// manejar y Express NUNCA contestaba la request (Express 4 no atrapa solo un throw async), así
// que el navegador terminaba mostrando "Failed to fetch" en vez de un error claro. Con el
// try/catch, cualquier error futuro se ve como mensaje legible en vez de quedar colgado.)
teambackRouter.get("/ganancia-semanal", requireTbAuth, requireTbAdmin, async (_req, res) => {
  try {
    res.json(await getGananciaPorSemana());
  } catch (err: any) {
    res.status(500).json({ error: err.message || "No se pudo calcular la ganancia por semana." });
  }
});

// (09/10/2026, pedido de Leo: "poner en espejo la wallet de adm poker... en modo espejo")
// -- espejo de SOLO LECTURA del saldo de la Wallet (WALLET_MANOS) del sistema principal.
// Admin-only a propósito (Leo: "Solo ADMIN") -- un jugador nunca debe ver esto, por eso
// requireTbAdmin y no requireTbPlayer. No escribe nada: ni ajusta ni mueve la Wallet real,
// solo la lee (ver repo/treasury.ts, getSaldoWalletNeto).
teambackRouter.get("/wallet-espejo", requireTbAuth, requireTbAdmin, async (_req, res) => {
  try {
    res.json({ saldo: await getSaldoWalletNeto() });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "No se pudo obtener el saldo de la Wallet." });
  }
});

// (25/09/2026, pedido de Leo: "en liquidaciones recorda lo del boton de PAGAR y despues Pagado")
// -- el pago se marca por liquidación individual (jugador+semana), no por semana entera.
teambackRouter.post("/liquidaciones/:id/pagar", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  const medioPago = req.body?.medioPago;
  if (medioPago !== "USDT" && medioPago !== "FICHAS") {
    return res.status(400).json({ error: 'medioPago tiene que ser "USDT" o "FICHAS".' });
  }
  try {
    res.json(await marcarLiquidacionPagada(req.params.id, medioPago, `TeamBack:${req.tbUser.username}`));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo marcar como pagada." });
  }
});

teambackRouter.delete("/liquidaciones/:id/pagar", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  try {
    res.json(await marcarLiquidacionNoPagada(req.params.id, `TeamBack:${req.tbUser.username}`));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo deshacer el pago." });
  }
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

// (09/10/2026, pedido de Leo: "deberiamos poder ver el desglose de cada jugador y que generó
// para que el lo pueda ver") -- misma función que usa el admin (getLiquidacionIndividual, con el
// desglose de referidos incluido), pero SIEMPRE con el playerId del propio token -- nunca uno
// elegido por el cliente -- mismo criterio que el resto del portal (ver mi-cuenta/historial
// arriba). Así el jugador puede ver, semana por semana, qué generó cada uno de sus referidos.
teambackRouter.get("/portal/liquidacion/:weekStart", requireTbAuth, requireTbPlayer, async (req: any, res) => {
  try {
    res.json(await getLiquidacionIndividual(req.tbUser.playerId, req.params.weekStart));
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------------------------
// Notificaciones push (13/10/2026, pedido de Leo) -- ver lib/push.ts y repo/teamback.ts. Las 4
// de abajo que mandan push de verdad son TODAS admin-only y TODAS manuales: ninguna se dispara
// desde /liquidaciones/calcular ni desde /liquidaciones/:id/pagar de arriba, a propósito.
// ---------------------------------------------------------------------------------------------

const subscribeSchema = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
teambackRouter.post("/push/subscribe", requireTbAuth, requireTbPlayer, async (req: any, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    await guardarPushSubscription(req.tbUser.playerId, parsed.data, req.headers["user-agent"] ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo guardar la suscripción." });
  }
});

teambackRouter.post("/push/unsubscribe", requireTbAuth, requireTbPlayer, async (req: any, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: "Falta el endpoint." });
  await eliminarPushSubscription(endpoint);
  res.json({ ok: true });
});

teambackRouter.get("/push/log", requireTbAuth, requireTbAdmin, async (req, res) => {
  try {
    res.json(await getLogNotificaciones(req.query.tipo as string | undefined, req.query.weekStart as string | undefined));
  } catch (err: any) {
    res.status(500).json({ error: err.message || "No se pudo obtener el historial de notificaciones." });
  }
});

teambackRouter.post("/push/notificar-liquidacion-cerrada", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  const weekStart = req.body?.weekStart;
  if (!weekStart) return res.status(400).json({ error: "Falta weekStart." });
  try {
    res.json(await notificarLiquidacionCerrada(weekStart, `TeamBack:${req.tbUser.username}`));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo notificar la liquidación cerrada." });
  }
});

teambackRouter.post("/push/notificar-liquidacion-pagada/:id", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  try {
    res.json(await notificarLiquidacionPagada(req.params.id, `TeamBack:${req.tbUser.username}`));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo notificar el pago." });
  }
});

teambackRouter.post("/push/notificar-referidos-activos", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  const weekStart = req.body?.weekStart;
  if (!weekStart) return res.status(400).json({ error: "Falta weekStart." });
  try {
    res.json(await notificarReferidosActivos(weekStart, `TeamBack:${req.tbUser.username}`));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo notificar a los referentes." });
  }
});

// (13/10/2026, pedido de Leo: "podemos cargar nosotros la imagen?") -- sube el archivo a
// Vercel Blob Storage (hace falta la env var BLOB_READ_WRITE_TOKEN -- se crea sola al conectar
// un Blob Store al proyecto desde el dashboard de Vercel) y devuelve la URL pública para usarla
// después como imagenUrl del aviso. No se guarda nada en Postgres -- el archivo en sí vive en
// Blob, aquí solo se referencia por URL en tb_push_notifications_log.imagen_url.
teambackRouter.post("/push/upload-imagen", requireTbAuth, requireTbAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo." });
  if (!req.file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Tiene que ser una imagen." });
  }
  try {
    const nombre = `teamback-avisos/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const blob = await subirAVercelBlob(nombre, req.file.buffer, {
      access: "public",
      contentType: req.file.mimetype,
    });
    res.json({ url: blob.url });
  } catch (err: any) {
    res.status(500).json({
      error:
        err.message?.includes("BLOB_READ_WRITE_TOKEN") || err.message?.includes("No token")
          ? "Falta conectar un Blob Store a este proyecto en Vercel (Storage -> Create Database -> Blob)."
          : err.message || "No se pudo subir la imagen.",
    });
  }
});

const broadcastSchema = z.object({
  titulo: z.string().min(1),
  mensaje: z.string().min(1),
  playerId: z.string().nullable().optional(),
  imagenUrl: z.string().url().nullable().optional(),
});
teambackRouter.post("/push/broadcast", requireTbAuth, requireTbAdmin, async (req: any, res) => {
  const parsed = broadcastSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(
      await enviarBroadcast(
        parsed.data.titulo,
        parsed.data.mensaje,
        parsed.data.playerId ?? null,
        `TeamBack:${req.tbUser.username}`,
        parsed.data.imagenUrl ?? null
      )
    );
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo mandar el anuncio." });
  }
});

// (13/10/2026, pedido de Leo) -- borra un aviso del historial. No revoca la notificación ya
// entregada (imposible), solo lo saca de la lista.
teambackRouter.delete("/push/log/:id", requireTbAuth, requireTbAdmin, async (req, res) => {
  try {
    await eliminarLogNotificacion(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo borrar el aviso." });
  }
});
