import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../lib/auth.js";
import { analizarImportacionSuprema, asignarAgenteJugador, listClubesImportacionSuprema, crearAgenteDesdeImportacion } from "../repo/imports.js";
import { analizarImportacionTeamBackGG, listClubesImportacionTeamBackGG } from "../repo/importsTeamBackGG.js";
import { analizarImportacionTinyGG, listClubesImportacionTinyGG } from "../repo/importsTinyGG.js";

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

// Mismo par de endpoints que Suprema, para la plataforma "GG Poker / TeamBack GG" (club
// "TeamBack GG" en el catálogo). "asignar-agente" y "crear-agente" de arriba son genéricos
// (no dependen del formato de archivo) — se reusan tal cual desde el frontend para esta
// plataforma también, no hace falta duplicarlos.
importsRouter.get("/teamback-gg/clubs", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listClubesImportacionTeamBackGG());
});

importsRouter.post("/teamback-gg/preview", requireAuth, requireAdmin, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'file')." });
  try {
    const atDate = typeof req.body?.weekEnd === "string" && req.body.weekEnd ? req.body.weekEnd : new Date();
    let sheetClubOverrides: Record<string, string> | undefined;
    if (typeof req.body?.sheetClubOverrides === "string" && req.body.sheetClubOverrides) {
      try {
        const parsed = JSON.parse(req.body.sheetClubOverrides);
        if (parsed && typeof parsed === "object") sheetClubOverrides = parsed;
      } catch {
        return res.status(400).json({ error: "sheetClubOverrides no es JSON válido." });
      }
    }
    let sheetsIgnoradas: string[] | undefined;
    if (typeof req.body?.sheetsIgnoradas === "string" && req.body.sheetsIgnoradas) {
      try {
        const parsed = JSON.parse(req.body.sheetsIgnoradas);
        if (Array.isArray(parsed)) sheetsIgnoradas = parsed.filter((x) => typeof x === "string");
      } catch {
        return res.status(400).json({ error: "sheetsIgnoradas no es JSON válido." });
      }
    }
    const result = await analizarImportacionTeamBackGG(req.file.buffer, atDate, sheetClubOverrides, sheetsIgnoradas);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudo leer el archivo." });
  }
});

// Plataforma "Tiny GG" (club "Tiny"): a diferencia de Suprema/TeamBack GG (un archivo, varias
// hojas), acá cada super agente baja SU PROPIO archivo — este endpoint recibe VARIOS archivos
// a la vez (campo "files", no "file") y arma una sola previa agrupada por club. sheetClubOverrides
// / sheetsIgnoradas funcionan igual que en los otros importadores, pero la clave es el nombre
// del ARCHIVO (ej. "Tini poker.xlsx"), no un nombre de hoja.
importsRouter.get("/tiny-gg/clubs", requireAuth, requireAdmin, async (_req, res) => {
  res.json(await listClubesImportacionTinyGG());
});

importsRouter.post("/tiny-gg/preview", requireAuth, requireAdmin, upload.array("files", 50), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return res.status(400).json({ error: "Faltan los archivos (campo 'files')." });
  try {
    const atDate = typeof req.body?.weekEnd === "string" && req.body.weekEnd ? req.body.weekEnd : new Date();
    let sheetClubOverrides: Record<string, string> | undefined;
    if (typeof req.body?.sheetClubOverrides === "string" && req.body.sheetClubOverrides) {
      try {
        const parsed = JSON.parse(req.body.sheetClubOverrides);
        if (parsed && typeof parsed === "object") sheetClubOverrides = parsed;
      } catch {
        return res.status(400).json({ error: "sheetClubOverrides no es JSON válido." });
      }
    }
    let sheetsIgnoradas: string[] | undefined;
    if (typeof req.body?.sheetsIgnoradas === "string" && req.body.sheetsIgnoradas) {
      try {
        const parsed = JSON.parse(req.body.sheetsIgnoradas);
        if (Array.isArray(parsed)) sheetsIgnoradas = parsed.filter((x) => typeof x === "string");
      } catch {
        return res.status(400).json({ error: "sheetsIgnoradas no es JSON válido." });
      }
    }
    const archivos = files.map((f) => ({ fileName: f.originalname, buffer: f.buffer }));
    const result = await analizarImportacionTinyGG(archivos, atDate, sheetClubOverrides, sheetsIgnoradas);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "No se pudieron leer los archivos." });
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

const crearAgenteSchema = z.object({
  name: z.string().min(2),
  agentIdRaw: z.string().nullable().optional(),
  defaultSystem: z.enum(["PREPAGO", "WIN_LOSE"]).optional(),
});

// Crea de un clic el agente que faltaba (un superagente nuevo del archivo que todavía no
// existía en el catálogo) en vez de mandar al usuario a "Nuevo agente" aparte. Queda con
// external_id = agentIdRaw, así que vuelve a analizar el archivo (o la próxima semana) y ya
// matchea solo — sin asignación manual jugador por jugador.
importsRouter.post("/suprema/crear-agente", requireAuth, requireAdmin, async (req, res) => {
  const parsed = crearAgenteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const agent = await crearAgenteDesdeImportacion(parsed.data.name, parsed.data.agentIdRaw ?? null, parsed.data.defaultSystem);
    res.status(201).json(agent);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
