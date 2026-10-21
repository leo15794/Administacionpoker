import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import {
  guardarSuscripcion,
  eliminarSuscripcion,
  cantidadSuscripciones,
  listarDestinatarios,
  enviarAvisos,
  listarHistorial,
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
});

notificacionesRouter.post("/enviar", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = enviarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Revisá el título (hasta 60 caracteres), el mensaje (hasta 240) y que haya al menos un destinatario." });
  try {
    const r = await enviarAvisos({ ...parsed.data, userIds: [...new Set(parsed.data.userIds)], actor: req.user!.email });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "No se pudo enviar." });
  }
});
