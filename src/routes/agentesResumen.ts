import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { getResumenAgentePDF, listSemanasConResumenAgente } from "../repo/agentesResumen.js";

export const agentesResumenRouter = Router();

// Semanas con al menos un cierre aplicado, para el selector del PDF.
agentesResumenRouter.get("/semanas", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listSemanasConResumenAgente());
});

// Resumen completo de un agente para una semana (estado de cuenta + por club + detalle por
// jugador + subagentes) -- ver repo/agentesResumen.ts. 404 si ese agente no tiene ningún cierre
// aplicado esa semana (nada que mostrar).
agentesResumenRouter.get("/:agentId/:weekStart", requireAuth, requireAdmin, async (req, res) => {
  const r = await getResumenAgentePDF(req.params.agentId, req.params.weekStart);
  if (!r) return res.status(404).json({ error: "Este agente no tiene ningún cierre aplicado en esa semana." });
  res.json(r);
});
