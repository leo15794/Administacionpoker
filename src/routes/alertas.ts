import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { listarAlertas } from "../repo/alertas.js";

export const alertasRouter = Router();

// Campana de notificaciones del sistema (06/10/2026, pedido de Leo). Se recalcula en cada
// request -- no hay nada guardado que se pueda desincronizar, ver repo/alertas.ts.
alertasRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listarAlertas());
});
