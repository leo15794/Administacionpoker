// Repositorio del motor de "jugadores bancados" (ver schema.sql y engine/bancados.ts). Config
// y estado son por JUGADOR (players.id), no por agente — un jugador bancado sigue perteneciendo
// al roster normal de su agente, solo que su plata se liquida acá aparte en vez de en el cierre
// agregado semanal (ver repo/imports.ts, players.bancado).
import { pool, newId } from "../db/pool.js";
import { calcularCierreBancado, type BancadoConfig, type BancadoEstado, type BancadoOrigen } from "../engine/bancados.js";

export interface BancadoConfigInput {
  pctJugador: number;
  pctBanca: number;
  rakebackPct: number;
  capitalInicial: number;
  makeupInicial: number;
  moneda?: string;
  regla?: string | null;
  observaciones?: string | null;
  recuperacionMakeup?: string | null;
}

export async function getBancadoConfig(playerId: string) {
  const r = await pool.query(`SELECT * FROM bancado_config WHERE player_id = $1`, [playerId]);
  return r.rows[0] ?? null;
}

export async function upsertBancadoConfig(playerId: string, input: BancadoConfigInput) {
  const r = await pool.query(
    `INSERT INTO bancado_config
       (player_id, pct_jugador, pct_banca, rakeback_pct, capital_inicial, makeup_inicial, moneda, regla, observaciones, recuperacion_makeup, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (player_id) DO UPDATE SET
       pct_jugador = EXCLUDED.pct_jugador,
       pct_banca = EXCLUDED.pct_banca,
       rakeback_pct = EXCLUDED.rakeback_pct,
       capital_inicial = EXCLUDED.capital_inicial,
       makeup_inicial = EXCLUDED.makeup_inicial,
       moneda = EXCLUDED.moneda,
       regla = EXCLUDED.regla,
       observaciones = EXCLUDED.observaciones,
       recuperacion_makeup = EXCLUDED.recuperacion_makeup,
       updated_at = now()
     RETURNING *`,
    [
      playerId,
      input.pctJugador,
      input.pctBanca,
      input.rakebackPct,
      input.capitalInicial,
      input.makeupInicial,
      input.moneda ?? "USD",
      input.regla ?? null,
      input.observaciones ?? null,
      input.recuperacionMakeup ?? null,
    ]
  );
  return r.rows[0];
}

// Estado vigente (capital/makeup actual): el último cierre de banca no revertido de ese
// jugador, o los valores iniciales de la config si todavía no cerró ninguna semana — nunca se
// guarda aparte (a diferencia de la planilla, que tiene ESTADO_BANCADOS como hoja separada):
// se deriva siempre del historial real, así nunca puede quedar desincronizado.
export async function getEstadoBancado(playerId: string, config: BancadoConfigInput): Promise<BancadoEstado> {
  const r = await pool.query(
    `SELECT capital_despues, makeup_nuevo FROM bancado_historial
     WHERE player_id = $1 AND status <> 'REVERTIDO'
     ORDER BY week_start DESC, created_at DESC LIMIT 1`,
    [playerId]
  );
  if (r.rows[0]) {
    return { capitalActual: Number(r.rows[0].capital_despues), makeupActual: Number(r.rows[0].makeup_nuevo) };
  }
  return { capitalActual: config.capitalInicial, makeupActual: config.makeupInicial };
}

export interface CierreBancadoInput {
  playerId: string;
  weekStart: string;
  weekEnd: string;
  resultadoMesas: number;
  rakeTotal: number;
  observaciones?: string | null;
  createdBy?: string | null;
}

async function prepararCalculo(playerId: string, origen: BancadoOrigen) {
  const config = await getBancadoConfig(playerId);
  if (!config) {
    throw new Error("Este jugador todavía no tiene configurada la banca (% jugador/banca/rakeback, capital y makeup inicial) — cargala primero en Jugadores bancados.");
  }
  const playerRes = await pool.query(
    `SELECT p.id, p.display_name, p.club_id, p.agent_id, c.name as club_name, a.name as agent_name
     FROM players p JOIN clubs c ON c.id = p.club_id LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $1`,
    [playerId]
  );
  const player = playerRes.rows[0];
  if (!player) throw new Error("Jugador no encontrado.");

  const cfg: BancadoConfig = {
    pctJugador: Number(config.pct_jugador),
    pctBanca: Number(config.pct_banca),
    rakebackPct: Number(config.rakeback_pct),
    capitalInicial: Number(config.capital_inicial),
    makeupInicial: Number(config.makeup_inicial),
  };
  const estado = await getEstadoBancado(playerId, cfg);
  const calc = calcularCierreBancado(cfg, estado, origen);
  return { config, cfg, estado, calc, player };
}

// Solo calcula, no escribe nada — mismo motor que cerrarCierreBancado, para que la vista
// previa nunca pueda mostrar un número distinto del que después se aplica de verdad.
export async function previsualizarCierreBancado(playerId: string, origen: BancadoOrigen) {
  const { calc, player, cfg } = await prepararCalculo(playerId, origen);
  return { calc, player, cfg };
}

export async function cerrarCierreBancado(input: CierreBancadoInput) {
  const { calc, config, player } = await prepararCalculo(input.playerId, {
    resultadoMesas: input.resultadoMesas,
    rakeTotal: input.rakeTotal,
  });

  const existing = await pool.query(
    `SELECT id FROM bancado_historial WHERE player_id = $1 AND week_start = $2 AND status <> 'REVERTIDO'`,
    [input.playerId, input.weekStart]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, alreadyApplied: true, calc };
  }

  const id = newId("banh");
  await pool.query(
    `INSERT INTO bancado_historial (
       id, player_id, agent_id, club_id, week_start, week_end,
       resultado_mesas, rake_total, rakeback_total, makeup_anterior, perdida_agrega_makeup,
       rakeback_a_makeup, rakeback_excedente_jugador, makeup_nuevo, pago_jugador_mesas,
       pago_jugador_total, ganancia_banca_mesas, capital_anterior, capital_despues,
       pct_jugador_snapshot, pct_banca_snapshot, rakeback_pct_snapshot, observaciones, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      id,
      input.playerId,
      player.agent_id,
      player.club_id,
      input.weekStart,
      input.weekEnd,
      calc.resultadoMesas,
      calc.rakeTotal,
      calc.rakebackTotal,
      calc.makeupAnterior,
      calc.perdidaAgregaMakeup,
      calc.rakebackAMakeup,
      calc.rakebackExcedenteJugador,
      calc.makeupNuevo,
      calc.pagoJugadorMesas,
      calc.pagoJugadorTotal,
      calc.gananciaBancaMesas,
      calc.capitalAnterior,
      calc.capitalDespues,
      config.pct_jugador,
      config.pct_banca,
      config.rakeback_pct,
      input.observaciones ?? null,
      input.createdBy ?? null,
    ]
  );

  return { id, alreadyApplied: false, calc };
}

export async function listHistorialBancado(playerId: string) {
  const r = await pool.query(
    `SELECT * FROM bancado_historial WHERE player_id = $1 ORDER BY week_start DESC`,
    [playerId]
  );
  return r.rows;
}

// Historial global (todos los jugadores bancados juntos) — equivalente a HISTORIAL_BANCADOS_
// MASTER de la planilla.
export async function listHistorialBancadoGlobal() {
  const r = await pool.query(
    `SELECT h.*, p.display_name as player_name, p.external_id as player_external_id,
            c.name as club_name, a.name as agent_name
     FROM bancado_historial h
     JOIN players p ON p.id = h.player_id
     JOIN clubs c ON c.id = h.club_id
     LEFT JOIN agents a ON a.id = h.agent_id
     ORDER BY h.week_start DESC, p.display_name`
  );
  return r.rows;
}

export async function revertirCierreBancado(id: string, motivo?: string) {
  const r = await pool.query(
    `UPDATE bancado_historial SET status = 'REVERTIDO', motivo_reversion = $2
     WHERE id = $1 AND status <> 'REVERTIDO' RETURNING id`,
    [id, motivo ?? null]
  );
  return { found: r.rows.length > 0 };
}
