// Importación de cierres — plataforma "Tiny GG" (club "Tiny GG" en el catálogo). A diferencia
// de TeamBack GG (un archivo, varias hojas, una por club/super agente), acá CADA super agente
// baja su propio archivo .xlsx — esta corrida recibe VARIOS archivos. Desde la auditoría de
// 10/09/2026 contra la planilla "automatizacion clubes": el super agente de cada archivo es
// solo METADATA del reporte (queda como sheetName de referencia) — quien de verdad cobra es
// cada SUB-AGENTE de la hoja "2.代理數據統計"/"3.玩家數據" (ver engine/importTinyGG.ts), y se
// resuelve fila por fila (jugador -> agente) exactamente igual que TeamBack GG/Suprema, reusando
// sin cambios resolvePlayerAgent de imports.ts. Los sub-agentes se agrupan en la MISMA entrada
// de club aunque vengan de archivos (super agentes) distintos.
import { pool } from "../db/pool.js";
import { parseTinyGGFile } from "../engine/importTinyGG.js";
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
 * de hoja (acá "una hoja lógica" = "un archivo entero" para efectos de elegir club/ignorar).
 */
export async function analizarImportacionTinyGG(
  archivos: { fileName: string; buffer: Buffer }[],
  atDate: string | Date = new Date(),
  sheetClubOverrides?: Record<string, string>,
  sheetsIgnoradas?: string[]
): Promise<ResultadoImportacion> {
  const hojasNoReconocidas: { sheetName: string; motivo: string; resolvable?: boolean }[] = [];
  const ignoradasSet = new Set(sheetsIgnoradas ?? []);
  // Vive para TODA la corrida: si el mismo sub-agente aparece en más de un archivo (no debería
  // pasar, pero no cuesta nada ser defensivo) no se auto-crea dos veces.
  const autoCreadosCache = new Map<string, ResolucionAgente>();
  // A diferencia de GG/Suprema (una hoja = un club = una entrada de ClubImportado), acá varios
  // ARCHIVOS pueden apuntar al mismo club (varios super agentes de Tiny) — se agrupan en la
  // MISMA entrada para que la previa se vea junta, no un bloque separado por archivo. El
  // acumulador de agentes también vive para toda la corrida (no por archivo), así un sub-agente
  // que por algún motivo aparezca en dos archivos queda sumado en una sola fila.
  const clubesMap = new Map<string, ClubImportado>();
  const agentesMapPorClub = new Map<string, Map<string, AgenteAgregado>>();

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

    let entry = clubesMap.get(club.id);
    if (!entry) {
      entry = { clubId: club.id, clubName: club.name, sheetName: archivo.fileName, agentes: [], sinAgente: [] };
      clubesMap.set(club.id, entry);
    }
    let agentesMap = agentesMapPorClub.get(club.id);
    if (!agentesMap) {
      agentesMap = new Map<string, AgenteAgregado>();
      agentesMapPorClub.set(club.id, agentesMap);
    }

    if (p.rows.length === 0) {
      hojasNoReconocidas.push({
        sheetName: archivo.fileName,
        motivo: `El archivo "${archivo.fileName}" (super agente ${p.superAgentNicknameRaw ?? p.superAgentIdRaw ?? "?"}) no trajo filas de jugador en la hoja "3.玩家數據".`,
      });
      continue;
    }

    for (const row of p.rows) {
      const resolucion = await resolvePlayerAgent(club.id, row, autoCreadosCache);
      await upsertPlayer(club.id, row, resolucion.agentId);

      if (!resolucion.agentId) {
        const sinAgente: JugadorSinAgente = {
          playerId: row.playerId,
          playerName: row.playerName,
          agentIdRaw: row.agentIdRaw,
          agentNameRaw: row.agentNameRaw,
          resultado: row.resultado,
          rake: row.rake,
          motivo: resolucion.motivo ?? "Sin agente resuelto.",
        };
        entry.sinAgente.push(sinAgente);
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
  }

  for (const [clubId, entry] of clubesMap) {
    const agentesMap = agentesMapPorClub.get(clubId)!;
    const agentes: AgenteAgregado[] = [];
    for (const acc of agentesMap.values()) {
      const cfg = await resolverConfigVigente(acc.agentId, clubId, atDate);
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
    entry.agentes = agentes;
  }

  const agentesAutoCreados: AgenteAutoCreado[] = [...autoCreadosCache.values()].map((r) => ({
    agentId: r.agentId!,
    agentName: r.agentName!,
    agentIdRaw: r.agentIdRawCreado ?? null,
  }));

  return { clubes: [...clubesMap.values()], hojasNoReconocidas, agentesAutoCreados };
}
