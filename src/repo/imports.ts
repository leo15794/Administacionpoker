// Importación de cierres desde archivo — orquesta el parseo puro (engine/importSuprema.ts)
// con la base: a qué club corresponde cada hoja, a qué agente corresponde cada jugador, y
// qué % de rakeback/rebate le toca a cada agente (siempre desde la configuración del sistema,
// nunca desde el archivo — así lo pidió el usuario).
import { pool, newId } from "../db/pool.js";
import { parseSupremaWorkbook, type SupremaPlayerRow } from "../engine/importSuprema.js";
import { resolverConfigVigente, upsertAgent, updateAgent } from "./catalog.js";

/** Type= "manual" | "auto" - el motivo por el que se creó, para que el frontend pueda avisar
 * cuáles fueron auto-creados esta corrida (a diferencia de los que ya existían de antes). */
export interface AgenteAutoCreado {
  agentId: string;
  agentName: string;
  agentIdRaw: string | null;
}

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
  agentIdRaw: string | null;
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
  // Superagentes que no existían en el catálogo y se crearon solos esta corrida porque el
  // archivo traía su nombre (ver resolvePlayerAgent) — se informa para que quede claro que no
  // fue "magia": el frontend puede mostrar la lista y, si algún nombre es en realidad un typo
  // de un agente que ya existía, el usuario lo corrige a mano (moverAgenteDeClub / eliminar
  // desde el Árbol de clubes) en vez de que quede colado en silencio.
  agentesAutoCreados: AgenteAutoCreado[];
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

/** Exportado para que otros parsers de plataforma (ej. repo/importsTeamBackGG.ts) puedan
 * reusar exactamente la misma resolución de agente (override > external_id > nombre >
 * auto-creación) sin duplicarla — la lógica es genérica sobre "un archivo trae un agente
 * crudo para un jugador", no específica de Suprema. */
export interface ResolucionAgente {
  agentId: string | null;
  agentName: string | null;
  resolvedBy: "override" | "external_id" | "name" | "auto_creado" | null;
  motivo?: string;
  /** Solo seteado cuando resolvedBy === "auto_creado": el Agent ID crudo del archivo (si traía
   * uno), para poder informarlo en agentesAutoCreados sin tener que volver a mirar la fila. */
  agentIdRawCreado?: string | null;
}

/**
 * Resuelve a qué agente pertenece un jugador, en este orden de prioridad:
 *   1) Override manual guardado antes (player_agent_overrides) — siempre gana, incluso si el
 *      archivo esta semana SÍ trae Agent Name (por si el reporte vuelve a venir mal).
 *   2) Agent ID del archivo vs agents.external_id (match robusto, no depende del nombre).
 *   3) Agent Name del archivo vs agents.name (comparación case-insensitive, con trim).
 *   4) Si nada matchea pero el archivo SÍ trae un nombre de agente, se crea automáticamente
 *      (BIT-nueva: "que se cargue solo con el excel") — nunca queda plata de un jugador sin
 *      agente por el solo hecho de que el superagente todavía no existía en el catálogo. Solo
 *      se sigue reportando "sin agente" cuando el archivo directamente no trae Agent Name (no
 *      hay ningún nombre con el que crear nada).
 *
 * `autoCreadosCache` vive por corrida de análisis (una entrada por Agent ID/Name crudo): evita
 * crear el mismo agente nuevo dos veces si varios jugadores del archivo comparten el mismo
 * superagente todavía no creado — igual sería seguro (upsertAgent es ON CONFLICT(name) DO
 * UPDATE), pero así no se pega a la base una vez por cada jugador del grupo.
 */
export async function resolvePlayerAgent(
  clubId: string,
  row: SupremaPlayerRow,
  autoCreadosCache: Map<string, ResolucionAgente>
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

    // Nada matcheó: el archivo trae un nombre de agente que no existe en el catálogo. Se crea
    // solo (cacheado por esta corrida) en vez de reportarlo como "sin agente" — el % de
    // rakeback/rebate queda en el default del club hasta que se cargue un deal específico,
    // igual que cualquier agente nuevo (ver resolverConfigVigente).
    const clave = row.agentIdRaw ?? row.agentNameRaw;
    const cacheado = autoCreadosCache.get(clave);
    if (cacheado) return cacheado;

    const nuevo = await crearAgenteDesdeImportacion(row.agentNameRaw, row.agentIdRaw);
    const resolucion: ResolucionAgente = {
      agentId: nuevo.id,
      agentName: nuevo.name,
      resolvedBy: "auto_creado",
      agentIdRawCreado: row.agentIdRaw,
    };
    autoCreadosCache.set(clave, resolucion);
    return resolucion;
  }

  return {
    agentId: null,
    agentName: null,
    resolvedBy: null,
    motivo: `El archivo no trae agente para este jugador (Agent Name vacío) — asignalo manualmente.`,
  };
}

export async function upsertPlayer(clubId: string, row: SupremaPlayerRow, agentId: string | null) {
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
 * `sheetClubOverrides` (sheetName -> clubId): elección manual del usuario para cada hoja, SIEMPRE
 * explícita — no hay ningún auto-match ni sugerencia por nombre de hoja (se sacó adrede: dos
 * clubes reales pueden compartir el mismo nombre de pestaña entre semanas distintas, ej. "Fenix"
 * en un archivo de Suprema, y guardar esa asociación como default hizo que un club de otra
 * plataforma quedara mezclado con datos de Suprema). El nombre de la hoja no se usa para nada
 * más que mostrarlo en pantalla.
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
  // Vive para TODA la corrida (no por hoja/club): si el mismo superagente nuevo aparece en más
  // de una hoja/club del mismo archivo, se crea una sola vez.
  const autoCreadosCache = new Map<string, ResolucionAgente>();

  for (const sheet of parsed.sheets) {
    if (ignoradasSet.has(sheet.sheetName)) continue;

    // El club de esta hoja es SIEMPRE la elección explícita del usuario — no hay ningún
    // auto-match por nombre de hoja (ver nota arriba de por qué se sacó).
    let club: { id: string; name: string } | undefined;

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
        // Anotamos la plataforma en segundo plano (solo si no tenía ninguna todavía) — es
        // memoria interna para el día que haya más de un formato de importador, nunca un
        // requisito ni un filtro para poder usar este.
        await pool.query(
          `UPDATE clubs SET import_platform = COALESCE(import_platform, 'SUPREMA') WHERE id = $1`,
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

  const agentesAutoCreados: AgenteAutoCreado[] = [...autoCreadosCache.values()].map((r) => ({
    agentId: r.agentId!,
    agentName: r.agentName!,
    agentIdRaw: r.agentIdRawCreado ?? null,
  }));

  return { clubes, hojasNoReconocidas, agentesAutoCreados };
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

/**
 * Crea un agente nuevo directamente desde un jugador "sin agente" del importador (el
 * superagente todavía no existía en el catálogo) y lo deja resuelto para SIEMPRE: se graba
 * external_id = agentIdRaw, así que la próxima semana (y esta misma, si se vuelve a analizar el
 * archivo) ese superagente matchea solo por resolvePlayerAgent, sin tocar nada más a mano. El %
 * de rakeback/rebate queda en el default del club hasta que se configure uno específico (mismo
 * fallback que cualquier agente sin deal propio, ver resolverConfigVigente) — nunca se inventa
 * un % al crear.
 */
export async function crearAgenteDesdeImportacion(name: string, agentIdRaw: string | null, defaultSystem: "PREPAGO" | "WIN_LOSE" = "WIN_LOSE") {
  const agent = await upsertAgent(name, defaultSystem, null);
  if (agentIdRaw) {
    await updateAgent(agent.id, { externalId: agentIdRaw }).catch(() => {
      // Si external_id ya está usado por otro agente (raro), no bloquea la creación — el
      // matcheo por nombre igual va a funcionar de acá en adelante.
    });
  }
  return { id: agent.id, name: agent.name };
}
