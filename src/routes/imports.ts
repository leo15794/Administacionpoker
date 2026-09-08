import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { analizarImportacionSuprema, asignarAgenteJugador } from "../repo/imports.js";

export const importsRouter = Router();

// En memoria (no a disco): son archivos chicos (un cierre semanal) y no necesitamos
// conservarlos — la previa se recalcula subiendo el archivo de nuevo si hace falta.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB, generoso para un .xlsx de un cierre semanal
});

// Analiza (sin aplicar nada) un archivo semanal formato SupremaPoker: arma la previa de
// resultado/rake por agente usando la configuración de rakeback/rebate ya cargada en el
// sistema, y separa los jugadores que no se pudieron asignar a ningún agente. No toca
// weekly_closings/balances — eso lo hace el flujo ya existente de cierre semanal (movements.ts),
// que el frontend reutiliza fila por fila una vez que esta previa está resuelta.
importsRouter.post("/suprema/preview", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'file')." });
  try {
    const atDate = typeof req.body?.weekEnd === "string" && req.body.weekEnd ? req.body.weekEnd : new Date();
    const result = await analizarImportacionSuprema(req.file.buffer, atDate);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo leer el archivo." });
  }
});

const asignarSchema = z.object({
  playerExternalId: z.string().min(1),
  clubId: z.string().min(1),
  agentId: z.string().min(1),
  reason: z.string().min(1).default("Asignado manualmente desde el importador de cierres."),
});

// Guarda la asignación manual de un jugador que vino sin agente en el archivo (BIT-069):
// queda persistida (player_agent_overrides) para que no vuelva a aparecer como pendiente
// en futuras semanas aunque el reporte del club siga sin informar el agente.
importsRouter.post("/suprema/asignar-agente", requireAuth, requireAdmin, async (req, res) => {
  const parsed = asignarSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await asignarAgenteJugador(
      parsed.data.playerExternalId,
      parsed.data.clubId,
      parsed.data.agentId,
      parsed.data.reason
    );
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
