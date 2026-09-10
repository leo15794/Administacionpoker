// Importación de cierres — plataforma "Tiny GG" (club "Tiny" en el catálogo). A diferencia de
// TeamBack GG (un archivo, varias hojas, una por club/super agente), acá CADA super agente baja
// su propio archivo .xlsx — esta corrida recibe VARIOS archivos y los agrupa en la MISMA previa
// por club (ver analizarImportacionTinyGG). Reusa sin cambios la resolución de agente
// (override/external_id/nombre/auto-creación) exportada desde imports.ts.
import { pool } from "../db/pool.js";
import { parseTinyGGFile } from "../engine/importTinyGG.js";
import { resolverConfigVigente } from "./catalog.js";
import {
  resolvePlayerAgent,
  upsertPlayer,
  type ResolucionAgente,
  type AgenteAgregado,
  type ClubImportado,
  type ResultadoImportacion,
  type AgenteAutoCreado,
} from "./imports.js";

/** Mismos clubes elegibles que Suprema/GG — cualquier club activo. */
export async function listClubesImportacionTinyGG() {
  const r = await pool.query(`SELECT id, name FROM clubs WHERE active = true ORDER BY name`);
  return r.rows as { id: string; name: string }[];
}

/**
 * Parsea varios archivos Tiny GG (uno por super agente) y arma la previa de importación — misma
 * forma de resultado que analizarImportacionSuprema/TeamBackGG (ResultadoImportacion), para
 * reusar la misma UI de "Cierres a aplicar". `sheetClubOverrides`/`sheetsIgnoradas` funcionan
 * igual que en los otros importadores, pero la clave es el NOMBRE DEL ARCHIVO en vez del nombre
 * de hoja (acá "una hoja lógica" = "un archivo entero").
 */
export async function analizarImportacionTinyGG(
  archivos: { fileName: string; buffer: Buffer }[],
  atDate: string | Date = new Date(),
  sheetClubOverrides?: Record<string, string>,
  sheetsIgnoradas?: string[]
): Promise<ResultadoImportacion> {
  const hojasNoReconocidas: { sheetName: string; motivo: string; resolvable?: boolean }[] = [];
  const ignoradasSet = new Set(sheetsIgnoradas ?? []);
  // Vive para TODA la corrida: si dos archivos traen un super agente nuevo con el mismo nombre
  // (no debería pasar, cada archivo es de uno distinto) no se crea dos veces.
  const autoCreadosCache = new Map<string, ResolucionAgente>();
  // A diferencia de GG/Suprema (una hoja = un club = una entrada de ClubImportado), acá varios
  // ARCHIVOS pueden apuntar al mismo club (varios super agentes de Tiny) — se agrupan en la
  // MISMA entrada para que la previa se vea junta, no un bloque separado por archivo.
  const clubesMap = new Map<string, ClubImportado>();

  for (const archivo of archivos) {
    if (ignoradasSet.has(archivo.fileName)) continue;

    const resultado = await parseTinyGGFile(archivo.buffer, archivo.fileName);
    if ("error" in resultado) {
      hojasNoReconocidas.push({ sheetName: resultado.error.fileName, motivo: resultado.error.reason });
      continue;
    }
    const p = resultado.parsed;

    let club: { id: string; name: string } | undefined;
    const overrideClubId = sheetClubOverrides?.[archivo.fileName];
    if (overrideClubId) {
      const r = await pool.query(`SELECT id, name FROM clubs WHERE id = $1 AND active = true`, [overrideClubId]);
      const overrideClub = r.rows[0] as { id: string; name: string } | undefined;
      if (overrideClub) {
        club = overrideClub;
        await pool.query(`UPDATE clubs SET import_platform = COALESCE(import_platform, 'TINY_GG') WHERE id = $1`, [
          overrideClub.id,
        ]);
      }
    }
    if (!club) {
      hojasNoReconocidas.push({
        sheetName: archivo.fileName,
        motivo: `Ninguna configuración de club tiene "${archivo.fileName}" como archivo de importación — elegí a qué club corresponde este archivo.`,
        resolvable: true,
      });
      continue;
    }

    const syntheticRow = {
      playerId: p.superAgentIdRaw ?? p.superAgentNicknameRaw ?? archivo.fileName,
      playerName: p.superAgentNicknameRaw ?? p.superAgentIdRaw ?? archivo.fileName,
      agentIdRaw: p.superAgentIdRaw,
      agentNameRaw: p.superAgentNicknameRaw,
      resultado: p.resultado,
      rake: p.rake,
      rodeo: 0,
      role: "Super Agent",
      subAgentIdRaw: null,
      subAgentNameRaw: null,
    };
    const resolucion = await resolvePlayerAgent(club.id, syntheticRow, autoCreadosCache);
    await upsertPlayer(club.id, syntheticRow, resolucion.agentId);

    let entry = clubesMap.get(club.id);
    if (!entry) {
      entry = { clubId: club.id, clubName: club.name, sheetName: archivo.fileName, agentes: [], sinAgente: [] };
      clubesMap.set(club.id, entry);
    }

    if (!resolucion.agentId) {
      entry.sinAgente.push({
        playerId: syntheticRow.playerId,
        playerName: syntheticRow.playerName,
        agentIdRaw: syntheticRow.agentIdRaw,
        agentNameRaw: syntheticRow.agentNameRaw,
        resultado: p.resultado,
        rake: p.rake,
        motivo: resolucion.motivo ?? `El archivo "${archivo.fileName}" no trae un nombre de super agente identificable.`,
      });
      continue;
    }

    const cfg = await resolverConfigVigente(resolucion.agentId, club.id, atDate);
    entry.agentes.push({
      agentId: resolucion.agentId,
      agentName: resolucion.agentName!,
      jugadores: 1,
      resultado: p.resultado,
      rakeTotal: p.rake,
      rodeoJugadores: [],
      system: cfg.system,
      rakebackPct: cfg.rakebackPct,
      rebatePct: cfg.rebatePct,
      configSource: cfg.source,
      bbjContribution: p.bbjContribution,
    } satisfies AgenteAgregado);
  }

  for (const entry of clubesMap.values()) entry.agentes.sort((a, b) => a.agentName.localeCompare(b.agentName));

  const agentesAutoCreados: AgenteAutoCreado[] = [...autoCreadosCache.values()].map((r) => ({
    agentId: r.agentId!,
    agentName: r.agentName!,
    agentIdRaw: r.agentIdRawCreado ?? null,
  }));

  return { clubes: [...clubesMap.values()], hojasNoReconocidas, agentesAutoCreados };
}
