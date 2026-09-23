import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { listResumenRodeo } from "../repo/rodeo.js";

export const rodeoRouter = Router();

// Resumen por agente+club de la memoria de Rodeo (solo SupremaPoker) — ver repo/rodeo.ts.
rodeoRouter.get("/resumen", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listResumenRodeo());
});
