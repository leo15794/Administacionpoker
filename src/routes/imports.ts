import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { analizarImportacionSuprema, asignarAgenteJugador, listClubesImportacionSuprema } from "../repo/imports.js";

export const importsRouter = Router();

// Clubes elegibles para el selector "a qué club corresponde esta hoja" del importador de
// Suprema — filtrados por plataforma (import_platform = 'SUPREMA') para que no aparezcan
// clubes de otras redes (ej. "Fénix GG", que es el mismo club real pero en otra plataforma).
importsRouter.get("/suprema/clubs", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listClubesImportacionSuprema());
});

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
    // Elección manual de club por hoja (cuando ninguna configuración de club coincide con el
    // nombre de la hoja) — llega como JSON serializado porque el resto del body es multipart.
    let sheetClubOverrides: Record<string, string> | undefined;
    if (typeof req.body?.sheetClubOverrides === "string" && req.body.sheetClubOverrides) {
      try {
        const parsed = JSON.parse(req.body.sheetClubOverrides);
        if (parsed && typeof parsed === "object") sheetClubOverrides = parsed;
      } catch {
        return res.status(400).json({ error: "sheetClubOverrides no es JSON válido." });
      }
    }
    // Hojas que el usuario decide no procesar esta semana (ej. una que no le interesa
    // importar) — se ignoran silenciosamente, ni se les pide club ni aparecen como error.
    let sheetsIgnoradas: string[] | undefined;
    if (typeof req.body?.sheetsIgnoradas === "string" && req.body.sheetsIgnoradas) {
      try {
        const parsed = JSON.parse(req.body.sheetsIgnoradas);
        if (Array.isArray(parsed)) sheetsIgnoradas = parsed.filter((x) => typeof x === "string");
      } catch {
        return res.status(400).json({ error: "sheetsIgnoradas no es JSON válido." });
      }
    }
    const result = await analizarImportacionSuprema(req.file.buffer, atDate, sheetClubOverrides, sheetsIgnoradas);
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
