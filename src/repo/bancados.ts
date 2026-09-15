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

// Resumen acumulado (todas las semanas activas, no revertidas) — para el panel de totales:
// cuánto rake generó ese jugador en total, cuánto de eso volvió como rakeback, y cuánto le
// quedó de rake neto a la banca (rake generado - rakeback pagado). No es un valor que se
// guarde aparte: se suma en vivo desde bancado_historial, igual que el estado (capital/makeup).
export interface BancadoResumen {
  rakeGeneradoTotal: number;
  rakebackBancadoTotal: number;
  rakeBancaTotal: number;
  semanasCerradas: number;
}

export async function getResumenBancado(playerId: string): Promise<BancadoResumen> {
  const r = await pool.query(
    `SELECT
       COALESCE(SUM(rake_total), 0) as rake_generado_total,
       COALESCE(SUM(rakeback_total), 0) as rakeback_bancado_total,
       COUNT(*) as semanas_cerradas
     FROM bancado_historial
     WHERE player_id = $1 AND status <> 'REVERTIDO'`,
    [playerId]
  );
  const row = r.rows[0];
  const rakeGeneradoTotal = Number(row?.rake_generado_total ?? 0);
  const rakebackBancadoTotal = Number(row?.rakeback_bancado_total ?? 0);
  return {
    rakeGeneradoTotal,
    rakebackBancadoTotal,
    rakeBancaTotal: rakeGeneradoTotal - rakebackBancadoTotal,
    semanasCerradas: Number(row?.semanas_cerradas ?? 0),
  };
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
    `SELECT id FROM bancado_historial
     WHERE player_id = $1 AND week_start = $2 AND status <> 'REVERTIDO' AND tipo = 'CIERRE_SEMANAL'`,
    [input.playerId, input.weekStart]
  );
  if (existing.rows.length > 0) {
    return { id: existing.rows[0].id, alreadyApplied: true, calc };
  }

  const id = newId("banh");
  await pool.query(
    `INSERT INTO bancado_historial (
       id, player_id, agent_id, club_id, tipo, week_start, week_end,
       resultado_mesas, rake_total, rakeback_total, makeup_anterior, perdida_agrega_makeup,
       rakeback_a_makeup, rakeback_excedente_jugador, makeup_nuevo, pago_jugador_mesas,
       pago_jugador_total, ganancia_banca_mesas, capital_anterior, capital_despues,
       pct_jugador_snapshot, pct_banca_snapshot, rakeback_pct_snapshot, observaciones, created_by
     ) VALUES ($1,$2,$3,$4,'CIERRE_SEMANAL',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
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

export interface RecargaCapitalInput {
  playerId: string;
  monto: number; // positivo = recarga, negativo = descuento/ajuste
  fecha: string; // YYYY-MM-DD, se guarda en week_start y week_end (no representa una semana real)
  observaciones?: string | null;
  createdBy?: string | null;
}

// Ajuste manual de capital (18/09/2026): antes solo se podía setear el capital inicial una vez
// en la config, y encima dejaba de tener efecto en cuanto ya había algún cierre semanal cargado
// (el estado vigente siempre se lee del último historial, ver getEstadoBancado) — no había forma
// de "recargar fichas" si el jugador se quedaba en 0 o negativo a mitad de camino. Esto inserta
// una fila más en el mismo historial (tipo='RECARGA_CAPITAL') que solo mueve el capital: no
// toca rake/rakeback/makeup/pago/ganancia (todo en 0), así el resto de las cuentas de esa
// semana siguen intactas.
export async function registrarRecargaCapital(input: RecargaCapitalInput) {
  const config = await getBancadoConfig(input.playerId);
  if (!config) {
    throw new Error("Este jugador todavía no tiene configurada la banca — cargala primero en Jugadores bancados.");
  }
  const playerRes = await pool.query(
    `SELECT p.id, p.club_id, p.agent_id FROM players p WHERE p.id = $1`,
    [input.playerId]
  );
  const player = playerRes.rows[0];
  if (!player) throw new Error("Jugador no encontrado.");

  const estado = await getEstadoBancado(input.playerId, {
    pctJugador: Number(config.pct_jugador),
    pctBanca: Number(config.pct_banca),
    rakebackPct: Number(config.rakeback_pct),
    capitalInicial: Number(config.capital_inicial),
    makeupInicial: Number(config.makeup_inicial),
  });
  const capitalAnterior = estado.capitalActual;
  const capitalDespues = Math.round((capitalAnterior + input.monto + Number.EPSILON) * 100) / 100;

  const id = newId("banh");
  await pool.query(
    `INSERT INTO bancado_historial (
       id, player_id, agent_id, club_id, tipo, week_start, week_end,
       resultado_mesas, rake_total, rakeback_total, makeup_anterior, perdida_agrega_makeup,
       rakeback_a_makeup, rakeback_excedente_jugador, makeup_nuevo, pago_jugador_mesas,
       pago_jugador_total, ganancia_banca_mesas, capital_anterior, capital_despues,
       pct_jugador_snapshot, pct_banca_snapshot, rakeback_pct_snapshot, observaciones, created_by
     ) VALUES ($1,$2,$3,$4,'RECARGA_CAPITAL',$5,$5,$6,0,0,$7,0,0,0,$7,0,0,0,$8,$9,
               $10,$11,$12,$13,$14)`,
    [
      id,
      input.playerId,
      player.agent_id,
      player.club_id,
      input.fecha,
      input.monto,
      estado.makeupActual,
      capitalAnterior,
      capitalDespues,
      config.pct_jugador,
      config.pct_banca,
      config.rakeback_pct,
      input.observaciones ?? null,
      input.createdBy ?? null,
    ]
  );

  return { id, capitalAnterior, capitalDespues };
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

// BORRADO REAL (no revierte, elimina la fila) — mismo criterio que el borrado real de
// weekly_closings (movements.ts): SOLO para limpiar datos de prueba, nunca sobre un cierre de
// banca real ya operado (para eso está "Revertir", que mantiene el historial auditable). Acá es
// más simple que el de weekly_closings porque este módulo no toca ledger/saldos de agente — es
// un DELETE directo, no hay nada más que deshacer.
export async function eliminarCierreBancadoDefinitivo(id: string) {
  const r = await pool.query(`DELETE FROM bancado_historial WHERE id = $1 RETURNING id`, [id]);
  return { found: r.rows.length > 0 };
}
