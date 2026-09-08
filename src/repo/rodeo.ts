// Orquesta la memoria de Rodeo (solo SupremaPoker) contra la base. Corre DENTRO de la misma
// transacción que aplicarCierreSemanal (recibe su client, no abre/cierra conexión propia) —
// exactamente el mismo patrón que aplicarCierreBancadoTx: si el cierre hace ROLLBACK (vista
// previa), esta actualización de memoria se revierte sola, así preview y aplicar nunca pueden
// dar números distintos. Lockea cada fila de memoria con FOR UPDATE para que dos cierres del
// mismo jugador+club nunca puedan pisarse la memoria.
import type { PoolClient } from "pg";
import { newId } from "../db/pool.js";
import { calcularRodeoJugador, type RodeoJugadorResult } from "../engine/rodeo.js";

export interface RodeoJugadorEntrada {
  playerExternalId: string;
  baseRodeo: number;
}

export interface RodeoAgenteResultado {
  agentShareTotal: number;
  clubShareTotal: number;
  detalle: RodeoJugadorResult[];
}

/**
 * Procesa el Rodeo de todos los jugadores de un agente para un club, en la semana del
 * cierre que se está aplicando (o previsualizando). `tieneAgente` siempre es true acá —
 * esta función solo se llama para jugadores YA resueltos a un agente (ver repo/imports.ts);
 * los jugadores sin agente asignado no generan crédito para nadie y no se procesan por acá
 * (su rodeo queda solo informativo en la previa de importación, sin memoria persistida,
 * hasta que se les asigne un agente).
 */
export async function procesarRodeoAgenteTx(
  client: PoolClient,
  clubId: string,
  jugadores: RodeoJugadorEntrada[]
): Promise<RodeoAgenteResultado> {
  let agentShareTotal = 0;
  let clubShareTotal = 0;
  const detalle: RodeoJugadorResult[] = [];

  for (const j of jugadores) {
    const memRes = await client.query(
      `SELECT memory FROM rodeo_player_memory WHERE player_external_id = $1 AND club_id = $2 FOR UPDATE`,
      [j.playerExternalId, clubId]
    );
    const memoriaAnterior = memRes.rows[0] ? Number(memRes.rows[0].memory) : 0;

    const r = calcularRodeoJugador({
      playerExternalId: j.playerExternalId,
      baseRodeo: j.baseRodeo,
      memoriaAnterior,
      tieneAgente: true,
    });

    if (memRes.rows[0]) {
      await client.query(
        `UPDATE rodeo_player_memory SET memory = $1, updated_at = now() WHERE player_external_id = $2 AND club_id = $3`,
        [r.memoriaNueva, j.playerExternalId, clubId]
      );
    } else {
      await client.query(
        `INSERT INTO rodeo_player_memory (id, player_external_id, club_id, memory) VALUES ($1,$2,$3,$4)`,
        [newId("rodeomem"), j.playerExternalId, clubId, r.memoriaNueva]
      );
    }

    agentShareTotal += r.agentShare;
    clubShareTotal += r.clubShare;
    detalle.push(r);
  }

  return { agentShareTotal, clubShareTotal, detalle };
}
