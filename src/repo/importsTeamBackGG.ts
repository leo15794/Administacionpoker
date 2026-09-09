// Importación de cierres — plataforma "GG Poker / TeamBack GG" (club "TeamBack GG" en el
// catálogo). Espejo de repo/imports.ts (Suprema) pero con el parser de engine/importTeamBackGG.ts
// — se duplica el bucle de agregación a propósito (en vez de refactorizar imports.ts) para no
// arriesgar el camino de Suprema, que ya está verificado en producción. Reusa sin cambios la
// resolución de agente (override/external_id/nombre/auto-creación) exportada desde imports.ts,
// porque esa lógica es genérica y no depende del formato del archivo.
import { pool } from "../db/pool.js";
import { parseTeamBackGGWorkbook } from "../engine/importTeamBackGG.js";
import { resolverConfigVigente } from "./catalog.js";
import {
  resolvePlayerAgent,
  upsertPlayer,
  type ResolucionAgente,
  type AgenteAgregado,
  type JugadorSinAgente,
  type ClubImportado,
  type ResultadoImportacion,
  type AgenteAutoCreado,
} from "./imports.js";

/** Mismos clubes elegibles que Suprema — cualquier club activo, sin filtrar por plataforma (ver
 * nota igual en imports.ts sobre por qué nunca se bloquea la elección de club). */
export async function listClubesImportacionTeamBackGG() {
  const r = await pool.query(`SELECT id, name FROM clubs WHERE active = true ORDER BY name`);
  return r.rows as { id: string; name: string }[];
}

/**
 * Parsea el archivo TeamBack GG y arma la previa de importación — misma forma de resultado que
 * analizarImportacionSuprema (ResultadoImportacion), para que el frontend reuse exactamente la
 * misma UI de "Jugadores sin agente asignado" y "Cierres a aplicar". Ver esa función para el
 * detalle de cada parámetro (sheetClubOverrides/sheetsIgnoradas funcionan idéntico acá).
 */
export async function analizarImportacionTeamBackGG(
  buffer: Buffer,
  atDate: string | Date = new Date(),
  sheetClubOverrides?: Record<string, string>,
  sheetsIgnoradas?: string[]
): Promise<ResultadoImportacion> {
  const parsed = await parseTeamBackGGWorkbook(buffer);
  const clubes: ClubImportado[] = [];
  const hojasNoReconocidas: { sheetName: string; motivo: string; resolvable?: boolean }[] = parsed.hojasIgnoradas.map((h) => ({
    sheetName: h.sheetName,
    motivo: h.reason,
  }));
  const ignoradasSet = new Set(sheetsIgnoradas ?? []);
  const autoCreadosCache = new Map<string, ResolucionAgente>();

  for (const sheet of parsed.sheets) {
    if (ignoradasSet.has(sheet.sheetName)) continue;

    let club: { id: string; name: string } | undefined;
    const overrideClubId = sheetClubOverrides?.[sheet.sheetName];
    if (overrideClubId) {
      const r = await pool.query(`SELECT id, name FROM clubs WHERE id = $1 AND active = true`, [overrideClubId]);
      const overrideClub = r.rows[0] as { id: string; name: string } | undefined;
      if (overrideClub) {
        club = overrideClub;
        await pool.query(
          `UPDATE clubs SET import_platform = COALESCE(import_platform, 'TEAMBACK_GG') WHERE id = $1`,
          [overrideClub.id]
        );
      }
    }

    if (!club) {
      hojasNoReconocidas.push({
        sheetName: sheet.sheetName,
        motivo: `Ninguna configuración de club tiene "${sheet.sheetName}" como nombre de hoja de importación — elegí a qué club corresponde esta hoja.`,
        resolvable: true,
      });
      continue;
    }

    const agentesMap = new Map<string, AgenteAgregado>();
    const sinAgente: JugadorSinAgente[] = [];

    for (const row of sheet.rows) {
      const resolucion = await resolvePlayerAgent(club.id, row, autoCreadosCache);
      await upsertPlayer(club.id, row, resolucion.agentId);

      if (!resolucion.agentId) {
        sinAgente.push({
          playerId: row.playerId,
          playerName: row.playerName,
          agentIdRaw: row.agentIdRaw,
          agentNameRaw: row.agentNameRaw,
          resultado: row.resultado,
          rake: row.rake,
          motivo: resolucion.motivo ?? "Sin agente resuelto.",
        });
        continue;
      }

      const acc = agentesMap.get(resolucion.agentId);
      if (acc) {
        acc.jugadores += 1;
        acc.resultado += row.resultado;
        acc.rakeTotal += row.rake;
      } else {
        agentesMap.set(resolucion.agentId, {
          agentId: resolucion.agentId,
          agentName: resolucion.agentName!,
          jugadores: 1,
          resultado: row.resultado,
          rakeTotal: row.rake,
          rodeoJugadores: [], // no existe "Rodeo" en esta plataforma
          system: "WIN_LOSE",
          rakebackPct: 0,
          rebatePct: 0,
          configSource: "default_club",
        });
      }
    }

    const agentes: AgenteAgregado[] = [];
    for (const acc of agentesMap.values()) {
      const cfg = await resolverConfigVigente(acc.agentId, club.id, atDate);
      agentes.push({
        ...acc,
        resultado: Math.round(acc.resultado * 100) / 100,
        rakeTotal: Math.round(acc.rakeTotal * 100) / 100,
        system: cfg.system,
        rakebackPct: cfg.rakebackPct,
        rebatePct: cfg.rebatePct,
        configSource: cfg.source,
      });
    }
    agentes.sort((a, b) => a.agentName.localeCompare(b.agentName));

    clubes.push({ clubId: club.id, clubName: club.name, sheetName: sheet.sheetName, agentes, sinAgente });
  }

  const agentesAutoCreados: AgenteAutoCreado[] = [...autoCreadosCache.values()].map((r) => ({
    agentId: r.agentId!,
    agentName: r.agentName!,
    agentIdRaw: r.agentIdRawCreado ?? null,
  }));

  return { clubes, hojasNoReconocidas, agentesAutoCreados };
}
