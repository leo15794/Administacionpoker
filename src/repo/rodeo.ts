// Orquesta la memoria de Rodeo (solo SupremaPoker) contra la base. Corre DENTRO de la misma
// transacción que aplicarCierreSemanal (recibe su client, no abre/cierra conexión propia) —
// exactamente el mismo patrón que aplicarCierreBancadoTx: si el cierre hace ROLLBACK (vista
// previa), esta actualización de memoria se revierte sola, así preview y aplicar nunca pueden
// dar números distintos. Lockea la fila de memoria con FOR UPDATE para que dos cierres del
// mismo agente+club nunca puedan pisarse la memoria.
//
// CORRECCIÓN (auditoría vs. planilla real, hoja MEMORIA_RODEO): la memoria es por AGENTE+CLUB,
// no por jugador — ver nota completa en engine/rodeo.ts. La tabla rodeo_player_memory queda
// como estaba (nunca se borra, es historial) pero ya no se escribe: la memoria vigente vive en
// rodeo_agent_memory desde esta migración (schema.sql consolida la memoria vieja al pasar).
import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";
import { calcularRodeoAgente, type RodeoAgenteResult, type RodeoJugadorEntrada } from "../engine/rodeo.js";

export type { RodeoJugadorEntrada };

/**
 * Procesa el Rodeo de todos los jugadores de un agente para un club, en la semana del
 * cierre que se está aplicando (o previsualizando). Esta función solo se llama para jugadores
 * YA resueltos a un agente (ver repo/imports.ts); los jugadores sin agente asignado no generan
 * crédito para nadie y no se procesan por acá (su rodeo queda solo informativo en la previa de
 * importación, sin memoria persistida, hasta que se les asigne un agente).
 */
export async function procesarRodeoAgenteTx(
  client: PoolClient,
  agentId: string,
  clubId: string,
  jugadores: RodeoJugadorEntrada[]
): Promise<RodeoAgenteResult> {
  const memRes = await client.query(
    `SELECT memory FROM rodeo_agent_memory WHERE agent_id = $1 AND club_id = $2 FOR UPDATE`,
    [agentId, clubId]
  );
  const memoriaAnterior = memRes.rows[0] ? Number(memRes.rows[0].memory) : 0;

  const r = calcularRodeoAgente({ jugadores, memoriaAnterior, tieneAgente: true });

  if (memRes.rows[0]) {
    await client.query(
      `UPDATE rodeo_agent_memory SET memory = $1, updated_at = now() WHERE agent_id = $2 AND club_id = $3`,
      [r.memoriaNueva, agentId, clubId]
    );
  } else {
    await client.query(
      `INSERT INTO rodeo_agent_memory (id, agent_id, club_id, memory) VALUES ($1,$2,$3,$4)`,
      [newId("rodeoagentmem"), agentId, clubId, r.memoriaNueva]
    );
  }

  return r;
}

// Restaura la memoria de un agente+club al valor que tenía antes de un cierre revertido (ver
// revertirCierreSemanal en repo/closings.ts). Misma advertencia que bancados: asume reversión en
// orden cronológico inverso.
export async function restaurarMemoriaRodeoTx(agentId: string, clubId: string, memoriaAnterior: number) {
  await pool.query(
    `UPDATE rodeo_agent_memory SET memory = $1, updated_at = now() WHERE agent_id = $2 AND club_id = $3`,
    [memoriaAnterior, agentId, clubId]
  );
}

// Resumen por agente+club: memoria vigente + acumulado histórico de rodeo pagado, para poder
// ver de un vistazo si la memoria se está comportando bien (mismo criterio que
// listResumenBancados en repo/bancados.ts). Incluye combinaciones que tienen memoria guardada
// en rodeo_agent_memory (vienen de importación con rodeoJugadores) Y combinaciones que solo
// tuvieron rodeo cargado a mano (rodeoManual, que nunca toca la memoria -- ver
// repo/closings.ts) para no dejarlas afuera del resumen.
export interface ResumenRodeoAgente {
  agentId: string;
  agentName: string;
  clubId: string;
  clubName: string;
  memoriaActual: number;
  semanasConRodeo: number;
  rodeoPagadoAgenteTotal: number;
  rodeoClubTotal: number;
  ultimaSemana: string | null;
  // Detalle semana por semana (19/10/2026, pedido de Leo: "un desplegable para ver las diferentes semanas"),
  // de la más nueva a la más vieja, sin cierres revertidos. Si la semana vino de un rodeo cargado a mano
  // (rodeoManual, sin rodeo_detalle) bruto/memoria quedan en null y manual = true.
  semanas: SemanaRodeoAgente[];
}

export interface SemanaRodeoAgente {
  weekStart: string;
  weekEnd: string;
  manual: boolean;
  rodeoBruto: number | null; // suma del base de todos los jugadores (positivo = perdieron)
  memoriaAntes: number | null;
  aRepartir: number | null; // bruto - memoria antes, si es positivo (0 si no alcanzó)
  memoriaDespues: number | null;
  rodeoAgente: number; // lo que se sumó al cierre del agente
  rodeoClub: number; // informativo
  jugadores: { id: string; nombre: string; base: number }[];
}

export async function listResumenRodeo(): Promise<ResumenRodeoAgente[]> {
  const r = await pool.query(
    `WITH claves AS (
       SELECT agent_id, club_id FROM rodeo_agent_memory
       UNION
       SELECT agent_id, club_id FROM weekly_closings
       WHERE rodeo <> 0 OR rodeo_club_share <> 0 OR rodeo_detalle IS NOT NULL
     )
     SELECT
       k.agent_id, a.name AS agent_name,
       k.club_id, c.name AS club_name,
       COALESCE(rm.memory, 0) AS memoria_actual,
       COUNT(wc.id) FILTER (WHERE wc.rodeo_detalle IS NOT NULL AND wc.status <> 'REVERTIDO') AS semanas_con_rodeo,
       COALESCE(SUM(wc.rodeo) FILTER (WHERE wc.status <> 'REVERTIDO'), 0) AS rodeo_pagado_agente_total,
       COALESCE(SUM(wc.rodeo_club_share) FILTER (WHERE wc.status <> 'REVERTIDO'), 0) AS rodeo_club_total,
       MAX(wc.week_end) FILTER (
         WHERE wc.status <> 'REVERTIDO' AND (wc.rodeo <> 0 OR wc.rodeo_club_share <> 0 OR wc.rodeo_detalle IS NOT NULL)
       ) AS ultima_semana
     FROM claves k
     JOIN agents a ON a.id = k.agent_id
     JOIN clubs c ON c.id = k.club_id
     LEFT JOIN rodeo_agent_memory rm ON rm.agent_id = k.agent_id AND rm.club_id = k.club_id
     LEFT JOIN weekly_closings wc ON wc.agent_id = k.agent_id AND wc.club_id = k.club_id
     GROUP BY k.agent_id, a.name, k.club_id, c.name, rm.memory
     ORDER BY a.name, c.name`
  );

  // Semanas de todos los agente+club en una sola consulta; el nombre de cada jugador sale de players
  // (el detalle solo guarda el ID externo del proveedor).
  const sem = await pool.query(
    `SELECT wc.agent_id, wc.club_id, wc.week_start, wc.week_end, wc.rodeo, wc.rodeo_club_share, wc.rodeo_detalle
     FROM weekly_closings wc
     WHERE wc.status <> 'REVERTIDO' AND (wc.rodeo <> 0 OR wc.rodeo_club_share <> 0 OR wc.rodeo_detalle IS NOT NULL)
     ORDER BY wc.week_start DESC`
  );
  const ids = new Set<string>();
  for (const s of sem.rows) for (const j of s.rodeo_detalle?.jugadores ?? []) ids.add(String(j.playerExternalId));
  const nombres = new Map<string, string>();
  if (ids.size) {
    const pl = await pool.query(
      `SELECT DISTINCT ON (club_id, external_id) club_id, external_id, display_name
       FROM players WHERE external_id = ANY($1::text[]) ORDER BY club_id, external_id, created_at DESC`,
      [[...ids]]
    );
    for (const p of pl.rows) nombres.set(`${p.club_id}|${p.external_id}`, p.display_name || p.external_id);
  }
  const porClave = new Map<string, SemanaRodeoAgente[]>();
  for (const s of sem.rows) {
    const det = s.rodeo_detalle;
    const jug = (det?.jugadores ?? []).map((j: any) => ({
      id: String(j.playerExternalId),
      nombre: nombres.get(`${s.club_id}|${j.playerExternalId}`) ?? String(j.playerExternalId),
      base: Number(j.baseRodeo),
    }));
    const bruto = det ? jug.reduce((t: number, j: { base: number }) => t + j.base, 0) : null;
    const antes = det ? Number(det.memoriaAnterior ?? 0) : null;
    const item: SemanaRodeoAgente = {
      weekStart: String(s.week_start).slice(0, 10),
      weekEnd: String(s.week_end).slice(0, 10),
      manual: !det,
      rodeoBruto: bruto,
      memoriaAntes: antes,
      aRepartir: bruto !== null && antes !== null ? Math.max(0, bruto - antes) : null,
      memoriaDespues: det ? Number(det.memoriaNueva ?? 0) : null,
      rodeoAgente: Number(s.rodeo),
      rodeoClub: Number(s.rodeo_club_share),
      jugadores: jug,
    };
    const k = `${s.agent_id}|${s.club_id}`;
    const arr = porClave.get(k);
    if (arr) arr.push(item);
    else porClave.set(k, [item]);
  }

  return r.rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    clubId: row.club_id,
    clubName: row.club_name,
    memoriaActual: Number(row.memoria_actual),
    semanasConRodeo: Number(row.semanas_con_rodeo),
    rodeoPagadoAgenteTotal: Number(row.rodeo_pagado_agente_total),
    rodeoClubTotal: Number(row.rodeo_club_total),
    ultimaSemana: row.ultima_semana ? String(row.ultima_semana).slice(0, 10) : null,
    semanas: porClave.get(`${row.agent_id}|${row.club_id}`) ?? [],
  }));
}

