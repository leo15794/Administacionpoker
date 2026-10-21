import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  guardarSuscripcion,
  eliminarSuscripcion,
  cantidadSuscripciones,
  listarDestinatarios,
  enviarAvisos,
  listarHistorial,
  guardarImagen,
  obtenerImagen,
  destinatarioPuedeVerImagen,
  firmaValida,
  bandeja,
  marcarLeidos,
  eliminarAviso,
  MAX_BYTES_IMAGEN,
  MAX_IMAGENES_POR_AVISO,
  MIMES_IMAGEN,
} from "../repo/notificaciones.js";

export const notificacionesRouter = Router();

// ---- Lo que usa cada portal (supervisor, proveedor, agente) para activar los avisos en su celular ----
const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

notificacionesRouter.get("/mi-estado", requireAuth, async (req: AuthedRequest, res) => {
  res.json({ dispositivos: await cantidadSuscripciones(req.user!.userId) });
});

notificacionesRouter.post("/suscribir", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = subSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Suscripción inválida." });
  await guardarSuscripcion(req.user!.userId, parsed.data, req.headers["user-agent"] ?? null);
  res.json({ ok: true });
});

notificacionesRouter.post("/desuscribir", requireAuth, async (req: AuthedRequest, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (endpoint) await eliminarSuscripcion(req.user!.userId, endpoint);
  res.json({ ok: true });
});

// ---- Bandeja de avisos recibidos (cada portal) ----
notificacionesRouter.get("/bandeja", requireAuth, async (req: AuthedRequest, res) => {
  res.json(await bandeja(req.user!.userId));
});

notificacionesRouter.post("/bandeja/leidos", requireAuth, async (req: AuthedRequest, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string").slice(0, 100) : [];
  await marcarLeidos(req.user!.userId, ids);
  res.json({ ok: true });
});

// ---- Imágenes de los avisos ----
// Subida de a una, en crudo (el navegador la achica antes): Vercel limita el cuerpo de cada pedido a ~4,5 MB.
notificacionesRouter.post(
  "/imagen",
  requireAuth,
  requireAdmin,
  express.raw({ type: MIMES_IMAGEN, limit: MAX_BYTES_IMAGEN }),
  async (req: AuthedRequest, res) => {
    const mime = String(req.headers["content-type"] ?? "").split(";")[0];
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: "No llegó ninguna imagen (formatos: JPG, PNG, WEBP o GIF, hasta 4 MB)." });
    let nombre = "imagen";
    try {
      nombre = decodeURIComponent(String(req.headers["x-nombre"] ?? "imagen"));
    } catch {
      /* nombre inválido: queda "imagen" */
    }
    try {
      res.json(await guardarImagen({ nombre, mime, datos: req.body, actor: req.user!.email }));
    } catch (e: any) {
      res.status(400).json({ error: e?.message ?? "No se pudo guardar la imagen." });
    }
  }
);

function enviarBytes(res: express.Response, img: { nombre: string; mime: string; datos: Buffer }, descargar: boolean) {
  res.set("Content-Type", img.mime);
  if (descargar) {
    const seguro = img.nombre.replace(/[^\w.\- ]+/g, "_");
    res.set("Content-Disposition", `attachment; filename="${seguro}"`);
  }
  res.send(img.datos);
}

// Con sesión: el admin ve cualquiera; un portal solo las de avisos que le mandaron a él.
notificacionesRouter.get("/imagen/:id", requireAuth, async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  if (req.user!.role !== "ADMIN" && !(await destinatarioPuedeVerImagen(req.user!.userId, id))) return res.status(403).json({ error: "No tenés acceso a esa imagen." });
  const img = await obtenerImagen(id);
  if (!img) return res.status(404).json({ error: "La imagen no existe." });
  enviarBytes(res, img, req.query.descargar === "1");
});

// Sin sesión pero con firma: es la que baja el celular para mostrar la imagen dentro de la notificación.
notificacionesRouter.get("/publica/:id/:firma", async (req, res) => {
  const id = String(req.params.id);
  if (!firmaValida(id, String(req.params.firma))) return res.status(403).end();
  const img = await obtenerImagen(id);
  if (!img) return res.status(404).end();
  enviarBytes(res, img, false);
});

// ---- Lo que usa el admin: elegir a quién y enviar ----
notificacionesRouter.get("/destinatarios", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listarDestinatarios());
});

notificacionesRouter.get("/historial", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listarHistorial());
});

const enviarSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  titulo: z.string().trim().min(1).max(60),
  mensaje: z.string().trim().min(1).max(240),
  imagenIds: z.array(z.string().min(1)).max(MAX_IMAGENES_POR_AVISO).optional(),
});

notificacionesRouter.post("/enviar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = enviarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Revisá el título (hasta 60 caracteres), el mensaje (hasta 240), que haya al menos un destinatario y como máximo ${MAX_IMAGENES_POR_AVISO} imágenes.` });
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  try {
    const r = await enviarAvisos({ ...parsed.data, userIds: [...new Set(parsed.data.userIds)], baseUrl: `${proto}://${host}`, actor: req.user!.email });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "No se pudo enviar." });
  }
});

// Borrar un aviso enviado (por ejemplo los torneos de la semana pasada): desaparece de la bandeja de todos.
notificacionesRouter.delete("/aviso/:id", requireAuth, requireAdmin, async (req, res) => {
  const ok = await eliminarAviso(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "Ese aviso ya no existe." });
  res.json({ ok: true });
});
