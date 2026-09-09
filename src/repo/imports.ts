// Importación de cierres desde archivo — orquesta el parseo puro (engine/importSuprema.ts)
// con la base: a qué club corresponde cada hoja, a qué agente corresponde cada jugador, y
// qué % de rakeback/rebate le toca a cada agente (siempre desde la configuración del sistema,
// nunca desde el archivo — así lo pidió el usuario).
import { pool, newId } from "../db/pool.js";
import { parseSupremaWorkbook, type SupremaPlayerRow } from "../engine/importSuprema.js";
import { resolverConfigVigente } from "./catalog.js";

export interface AgenteAgregado {
  agentId: string;
  agentName: string;
  jugadores: number;
  resultado: number;
  rakeTotal: number;
  /** "Rodeo" (solo SupremaPoker): lista cruda por jugador (Player ID + baseRodeo del archivo,
   * signo: + = perdió, - = ganó). NUNCA es un total pre-sumado — el monto real que le toca al
   * agente depende de la memoria arrastrada de cada jugador individual, y esa memoria solo se
   * puede aplicar de forma transaccional (ver repo/rodeo.ts::procesarRodeoAgenteTx), que corre
   * recién en la vista previa/aplicación del cierre (movements.ts -> repo/closings.ts), nunca
   * acá en esta previa de solo lectura. Este array es lo que el frontend debe reenviar tal cual
   * como `rodeoJugadores` al pedir la previa o aplicar el cierre de este agente. */
  rodeoJugadores: { playerExternalId: string; baseRodeo: number }[];
  system: "PREPAGO" | "WIN_LOSE";
  rakebackPct: number;
  rebatePct: number;
  configSource: "deal" | "default_club";
}

export interface JugadorSinAgente {
  playerId: string;
  playerName: string;
  agentNameRaw: string | null;
  resultado: number;
  rake: number;
  motivo: string;
}

export interface ClubImportado {
  clubId: string;
  clubName: string;
  sheetName: string;
  agentes: AgenteAgregado[];
  sinAgente: JugadorSinAgente[];
}

export interface ResultadoImportacion {
  clubes: ClubImportado[];
  // `resolvable: true` = la hoja tiene el formato Suprema correcto pero ningún club activo
  // tiene esa hoja configurada como "Hoja de importación" — el frontend puede ofrecer elegir
  // el club a mano (ver sheetClubOverrides) en vez de tratarlo como un error sin salida.
  // `resolvable` ausente/false = la hoja no tiene el formato Suprema esperado (le faltan
  // columnas) — no hay club que elegir, no es una hoja de datos de club.
  hojasNoReconocidas: { sheetName: string; motivo: string; resolvable?: boolean }[];
}

async function resolveClubBySheet(sheetName: string) {
  const r = await pool.query(
    `SELECT id, name FROM clubs WHERE active = true
       AND import_source IS NOT NULL AND lower(trim(import_source)) = lower(trim($1)) LIMIT 1`,
    [sheetName]
  );
  return r.rows[0] as { id: string; name: string } | undefined;
}

/** Clubes elegibles como destino de una hoja de este importador — TODOS los clubes activos,
 * sin filtrar por plataforma: nunca bloquear al usuario por no tener un club "marcado" de
 * antemano, la elección de club para cada hoja es siempre suya y siempre libre. La plataforma
 * (import_platform) se anota sola en segundo plano cuando resuelve una hoja acá (ver más abajo)
 * — es memoria interna para el día que haya más de un formato de importador, nunca un requisito
 * para poder usar este. */
export async function listClubesImportacionSuprema() {
  const r = await pool.query(`SELECT id, name FROM clubs WHERE active = true ORDER BY name`);
  return r.rows as { id: string; name: string }[];
}

interface ResolucionAgente {
  agentId: string | null;
  agentName: string | null;
  resolvedBy: "override" | "external_id" | "name" | null;
  motivo?: string;
}

/**
 * Resuelve a qué agente pertenece un jugador, en este orden de prioridad:
 *   1) Override manual guardado antes (player_agent_overrides) — siempre gana, incluso si el
 *      archivo esta semana SÍ trae Agent Name (por si el reporte vuelve a venir mal).
 *   2) Agent ID del archivo vs agents.external_id (match robusto, no depende del nombre).
 *   3) Agent Name del archivo vs agents.name (comparación case-insensitive, con trim).
 * Si nada matchea, se reporta como pendiente de asignación manual (BIT-069): nunca se
 * inventa ni se descarta en silencio la plata de un jugador sin agente claro.
 */
async function resolvePlayerAgent(
  clubId: string,
  row: SupremaPlayerRow
): Promise<ResolucionAgente> {
  const overrideRes = await pool.query(
    `SELECT agent_id FROM player_agent_overrides WHERE player_external_id = $1 AND club_id = $2`,
    [row.playerId, clubId]
  );
  if (overrideRes.rows[0]) {
    const a = await pool.query(`SELECT id, name FROM agents WHERE id = $1`, [overrideRes.rows[0].agent_id]);
    if (a.rows[0]) return { agentId: a.rows[0].id, agentName: a.rows[0].name, resolvedBy: "override" };
  }

  if (row.agentIdRaw) {
    const a = await pool.query(`SELECT id, name FROM agents WHERE external_id = $1 AND active = true`, [row.agentIdRaw]);
    if (a.rows[0]) return { agentId: a.rows[0].id, agentName: a.rows[0].name, resolvedBy: "external_id" };
  }

  if (row.agentNameRaw) {
    const a = await pool.query(
      `SELECT id, name FROM agents WHERE active = true AND lower(trim(name)) = lower(trim($1))`,
      [row.agentNameRaw]
    );
    if (a.rows[0]) {
      // Aprovecha el match por nombre para dejar grabado el external_id — así la próxima
      // semana este mismo agente matchea directo por ID aunque el nombre venga distinto.
      if (row.agentIdRaw) {
        await pool
          .query(`UPDATE agents SET external_id = $1 WHERE id = $2 AND external_id IS NULL`, [row.agentIdRaw, a.rows[0].id])
          .catch(() => {
            // Si external_id ya está usado por otro agente (raro, dato del archivo pisado),
            // no bloquea la resolución de este jugador — solo no se guarda el atajo.
          });
      }
      return { agentId: a.rows[0].id, agentName: a.rows[0].name, resolvedBy: "name" };
    }
  }

  return {
    agentId: null,
    agentName: null,
    resolvedBy: null,
    motivo: row.agentNameRaw
      ? `El agente "${row.agentNameRaw}" del archivo no existe en el catálogo — creálo o asigná este jugador a otro agente.`
      : `El archivo no trae agente para este jugador (Agent Name vacío) — asignalo manualmente.`,
  };
}

async function upsertPlayer(clubId: string, row: SupremaPlayerRow, agentId: string | null) {
  await pool.query(
    `INSERT INTO players (id, external_id, display_name, club_id, agent_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (club_id, external_id) DO UPDATE SET display_name = EXCLUDED.display_name, agent_id = EXCLUDED.agent_id`,
    [newId("player"), row.playerId, row.playerName, clubId, agentId]
  );
}

/**
 * Parsea el archivo y arma la previa de importación: totales por agente (ya con el %
 * configurado en el sistema, nunca inventado) y la lista de jugadores sin agente resuelto.
 * Es de solo lectura sobre weekly_closings/balances — no aplica nada, eso lo hace el flujo
 * ya existente de vista previa/aplicar cierre (movements.ts), reutilizado por el frontend
 * fila por fila una vez que esta previa está limpia.
 *
 * `sheetClubOverrides` (sheetName -> clubId): elección manual del usuario, SIEMPRE explícita
 * (nunca depende de que el nombre de la hoja coincida con algo configurado). Si se resuelve
 * por acá y ningún otro club ya tenía ese nombre de hoja tomado, queda grabado como el
 * import_source de ese club — así la semana que viene, con el mismo nombre, viene precargado
 * como sugerencia (pero sigue siendo editable).
 *
 * `sheetsIgnoradas`: nombres de hoja que el usuario decide no procesar esta semana — se
 * saltean por completo (ni se les pide club ni aparecen como pendientes/error).
 */
export async function analizarImportacionSuprema(
  buffer: Buffer,
  atDate: string | Date = new Date(),
  sheetClubOverrides?: Record<string, string>,
  sheetsIgnoradas?: string[]
): Promise<ResultadoImportacion> {
  const parsed = await parseSupremaWorkbook(buffer);
  const clubes: ClubImportado[] = [];
  const hojasNoReconocidas: { sheetName: string; motivo: string; resolvable?: boolean }[] = parsed.hojasIgnoradas.map((h) => ({
    sheetName: h.sheetName,
    motivo: h.reason,
  }));
  const ignoradasSet = new Set(sheetsIgnoradas ?? []);

  for (const sheet of parsed.sheets) {
    if (ignoradasSet.has(sheet.sheetName)) continue;

    // La elección explícita del usuario SIEMPRE gana — el nombre de la hoja es solo una
    // sugerencia/atajo (si hay un club ya configurado con ese import_source), nunca un
    // requisito: el archivo es independiente del nombre de sus hojas.
    const autoMatched = await resolveClubBySheet(sheet.sheetName);
    let club: { id: string; name: string } | undefined = autoMatched;

    const overrideClubId = sheetClubOverrides?.[sheet.sheetName];
    if (overrideClubId) {
      // Sin filtro de plataforma acá: cualquier club activo es un destino válido para la
      // elección manual del usuario, tenga o no ya una plataforma anotada. La plataforma
      // nunca es un requisito para poder elegir un club.
      const r = await pool.query(
        `SELECT id, name FROM clubs WHERE id = $1 AND active = true`,
        [overrideClubId]
      );
      const overrideClub = r.rows[0] as { id: string; name: string } | undefined;
      if (overrideClub) {
        club = overrideClub;
        // Recién grabamos el nombre de hoja como import_source si NINGÚN club (ni siquiera
        // otro distinto al elegido) ya lo tiene tomado — si ya había un auto-match, la elección
        // manual de esta vez pisa el resultado para este archivo pero nunca la configuración
        // guardada, para que dos clubes no terminen compitiendo por el mismo nombre de hoja.
        if (!autoMatched) {
          await pool.query(
            `UPDATE clubs SET import_source = $1 WHERE id = $2 AND import_source IS NULL`,
            [sheet.sheetName, overrideClub.id]
          );
        }
        // Anotamos la plataforma en segundo plano (solo si no tenía ninguna todavía) — es
        // memoria interna para el día que haya más de un formato de importador, nunca un
        // requisito ni un filtro para poder usar este.
        await pool.query(
          `UPDATE clubs SET import_platform = COALESCE(import_platform, 'SUPREMA') WHERE id = $1`,
          [overrideClub.id]
        );
      }
    } else if (autoMatched) {
      // Mismo bookkeeping silencioso cuando el club se resolvió solo por nombre de hoja.
      await pool.query(
        `UPDATE clubs SET import_platform = COALESCE(import_platform, 'SUPREMA') WHERE id = $1`,
        [autoMatched.id]
      );
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
      const resolucion = await resolvePlayerAgent(club.id, row);
      await upsertPlayer(club.id, row, resolucion.agentId);

      if (!resolucion.agentId) {
        sinAgente.push({
          playerId: row.playerId,
          playerName: row.playerName,
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
        if (row.rodeo !== 0) acc.rodeoJugadores.push({ playerExternalId: row.playerId, baseRodeo: row.rodeo });
      } else {
        agentesMap.set(resolucion.agentId, {
          agentId: resolucion.agentId,
          agentName: resolucion.agentName!,
          jugadores: 1,
          resultado: row.resultado,
          rakeTotal: row.rake,
          rodeoJugadores: row.rodeo !== 0 ? [{ playerExternalId: row.playerId, baseRodeo: row.rodeo }] : [],
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
        rodeoJugadores: acc.rodeoJugadores.map((j) => ({
          ...j,
          baseRodeo: Math.round(j.baseRodeo * 100) / 100,
        })),
        system: cfg.system,
        rakebackPct: cfg.rakebackPct,
        rebatePct: cfg.rebatePct,
        configSource: cfg.source,
      });
    }
    agentes.sort((a, b) => a.agentName.localeCompare(b.agentName));

    clubes.push({ clubId: club.id, clubName: club.name, sheetName: sheet.sheetName, agentes, sinAgente });
  }

  return { clubes, hojasNoReconocidas };
}

/**
 * Guarda la asignación manual de un jugador sin agente resuelto (BIT-069): queda para
 * siempre en player_agent_overrides, así que en las próximas semanas ese Player ID no
 * vuelve a aparecer en "sin agente" aunque el reporte del club siga sin informarlo.
 */
export async function asignarAgenteJugador(playerExternalId: string, clubId: string, agentId: string, reason: string) {
  const id = newId("override");
  await pool.query(
    `INSERT INTO player_agent_overrides (id, player_external_id, club_id, agent_id, reason)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (player_external_id, club_id) DO UPDATE SET agent_id = EXCLUDED.agent_id, reason = EXCLUDED.reason`,
    [id, playerExternalId, clubId, agentId, reason]
  );
  await pool.query(`UPDATE players SET agent_id = $1 WHERE club_id = $2 AND external_id = $3`, [agentId, clubId, playerExternalId]);
  return { id };
}
