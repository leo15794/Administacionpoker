// Cuenta de prueba de TeamBack Afiliados (23/10/2026, pedido de Leo: "una cuenta test para un usuario en teamback afiliados donde
// nosotros podamos cargar a mano cierres y mostrar como funciona desde el lado del usuario").
//
// Un jugador de prueba es un tb_players con es_prueba = true, con su login de jugador. Se calcula EXACTO igual que uno real (mismo motor,
// misma config por defecto), pero queda fuera de todo lo real: totales, ganancia por semana, historial de pagos, árbol de referidos,
// cuentas de jugadores, avisos masivos y el cálculo semanal de verdad (ver los "NOT p.es_prueba" de repo/teamback.ts). Un pago de prueba
// nunca mueve la Wallet. Todo lo de este archivo trabaja SOLO con jugadores de prueba.

import { pool, newId } from "../db/pool.js";
import {
  asegurarColumnasPago,
  calcularYGuardarLiquidacionSemana,
  crearTbUser,
  getTbConfig,
  upsertTbPlayerConfig,
} from "./teamback.js";

async function getJugadorPrueba(id: string) {
  await asegurarColumnasPago();
  const r = await pool.query(`SELECT * FROM tb_players WHERE id = $1`, [id]);
  const j = r.rows[0];
  if (!j) throw new Error("No se encontró ese jugador.");
  if (!j.es_prueba) throw new Error("Ese jugador no es de prueba: desde acá solo se tocan las cuentas de prueba.");
  return j;
}

export async function listarCuentasPrueba() {
  await asegurarColumnasPago();
  const jugadores = await pool.query(
    `SELECT p.id, p.name, p.suprema_player_id, p.referido_por_id, ref.name AS referido_por_name,
            u.username, u.id AS user_id
     FROM tb_players p
     LEFT JOIN tb_players ref ON ref.id = p.referido_por_id
     LEFT JOIN tb_users u ON u.player_id = p.id
     WHERE p.es_prueba ORDER BY p.created_at`
  );
  const semanas = await pool.query(
    `SELECT p.id AS player_id, s.week_start, s.week_end, s.rake_bruto,
            l.id AS liquidacion_id, l.total_acreditado, l.rakeback_generado, l.comision_3pct_acreditada, l.pagado, l.medio_pago
     FROM tb_players p
     JOIN tb_weekly_stats s ON s.player_id = p.id
     LEFT JOIN tb_weekly_liquidations l ON l.player_id = p.id AND l.week_start = s.week_start
     WHERE p.es_prueba ORDER BY s.week_start DESC`
  );
  return { jugadores: jugadores.rows, semanas: semanas.rows };
}

export interface JugadorPruebaInput {
  name: string;
  username?: string | null;
  password?: string | null;
  referidoPorId?: string | null;
}

export async function crearJugadorPrueba(input: JugadorPruebaInput, hashFn: (pw: string) => Promise<string>) {
  await asegurarColumnasPago();
  const name = input.name.trim();
  if (!name) throw new Error("Poné un nombre para el jugador de prueba.");
  if (input.referidoPorId) await getJugadorPrueba(input.referidoPorId); // un referido de prueba solo cuelga de otro de prueba
  const conLogin = !!(input.username?.trim() || input.password);
  if (conLogin && (!input.username?.trim() || !input.password || input.password.length < 6)) {
    throw new Error("Para crear el usuario hacen falta un nombre de usuario y una contraseña de al menos 6 caracteres.");
  }
  const id = newId("tbp");
  await pool.query(
    `INSERT INTO tb_players (id, suprema_player_id, name, referido_por_id, es_prueba, notes)
     VALUES ($1, $2, $3, $4, TRUE, 'Cuenta de prueba')`,
    [id, `PRUEBA-${id.slice(-6).toUpperCase()}`, name, input.referidoPorId ?? null]
  );
  // Misma config que hoy es la general, así la liquidación de prueba se calcula como la de cualquier jugador.
  await upsertTbPlayerConfig(id, await getTbConfig());
  let usuario = null;
  if (conLogin) {
    try {
      usuario = await crearTbUser({ role: "PLAYER", username: input.username!, password: input.password!, name, playerId: id }, hashFn);
    } catch (err) {
      await borrarCuentaPrueba(id); // no dejar un jugador de prueba a medias si el usuario ya existía
      throw err;
    }
  }
  return { id, usuario };
}

/** Carga (o corrige) el rake de la semana de un jugador de prueba y recalcula las liquidaciones de prueba de esa semana. */
export async function cargarRakePrueba(playerId: string, weekStart: string, rake: number) {
  await getJugadorPrueba(playerId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error("La fecha de inicio de semana no es válida.");
  if (!Number.isFinite(rake) || rake < 0) throw new Error("El rake tiene que ser un número mayor o igual a 0.");
  const fin = await pool.query(`SELECT ($1::date + 6)::text AS fin`, [weekStart]);
  const weekEnd: string = fin.rows[0].fin;
  await pool.query(
    `INSERT INTO tb_weekly_stats (id, player_id, week_start, week_end, rake_bruto, import_source)
     VALUES ($1,$2,$3::date,$4::date,$5,'Carga manual (cuenta de prueba)')
     ON CONFLICT (player_id, week_start) DO UPDATE SET rake_bruto = EXCLUDED.rake_bruto, week_end = EXCLUDED.week_end`,
    [newId("tbs"), playerId, weekStart, weekEnd, rake]
  );
  return calcularYGuardarLiquidacionSemana(weekStart, weekEnd, true);
}

export async function borrarSemanaPrueba(playerId: string, weekStart: string) {
  await getJugadorPrueba(playerId);
  await pool.query(`DELETE FROM tb_weekly_liquidations WHERE player_id = $1 AND week_start = $2::date`, [playerId, weekStart]);
  await pool.query(`DELETE FROM tb_weekly_stats WHERE player_id = $1 AND week_start = $2::date`, [playerId, weekStart]);
  const fin = await pool.query(`SELECT ($1::date + 6)::text AS fin`, [weekStart]);
  // Los demás de prueba (el que lo refiere, por ejemplo) se recalculan sin ese rake.
  await pool.query(
    `DELETE FROM tb_weekly_liquidations l USING tb_players p
     WHERE p.id = l.player_id AND p.es_prueba AND l.week_start = $1::date
       AND NOT EXISTS (SELECT 1 FROM tb_weekly_stats s WHERE s.player_id = l.player_id AND s.week_start = l.week_start)
       AND NOT EXISTS (SELECT 1 FROM tb_weekly_stats s JOIN tb_players h ON h.id = s.player_id
                       WHERE h.referido_por_id = l.player_id AND s.week_start = l.week_start)`,
    [weekStart]
  );
  return calcularYGuardarLiquidacionSemana(weekStart, fin.rows[0].fin, true);
}

// Algunas tablas se crean recién la primera vez que se usan (ver asegurarTablas...): si todavía no existen, no hay nada que borrar.
async function borrarSiExiste(sql: string, id: string) {
  try {
    await pool.query(sql, [id]);
  } catch (err: any) {
    if (err.code !== "42P01") throw err;
  }
}

/** Borra la cuenta de prueba y todo lo que colgaba de ella (sus referidos de prueba, usuarios, semanas, liquidaciones, avisos). */
export async function borrarCuentaPrueba(playerId: string) {
  await getJugadorPrueba(playerId);
  const ids = (
    await pool.query(`SELECT id FROM tb_players WHERE es_prueba AND (id = $1 OR referido_por_id = $1)`, [playerId])
  ).rows.map((r) => r.id as string);
  // Primero los referidos (apuntan al titular), después el titular.
  const orden = [...ids.filter((i) => i !== playerId), playerId];
  for (const id of orden) {
    await borrarSiExiste(`DELETE FROM tb_push_subscriptions WHERE player_id = $1`, id);
    await borrarSiExiste(`DELETE FROM tb_push_notifications_log WHERE player_id = $1`, id);
    await borrarSiExiste(`DELETE FROM tb_player_movimientos WHERE player_id = $1`, id);
    await pool.query(`DELETE FROM tb_weekly_liquidations WHERE player_id = $1`, [id]);
    await pool.query(`DELETE FROM tb_weekly_stats WHERE player_id = $1`, [id]);
    await pool.query(`DELETE FROM tb_player_config WHERE player_id = $1`, [id]);
    await pool.query(`DELETE FROM tb_users WHERE player_id = $1`, [id]);
    await pool.query(`DELETE FROM tb_players WHERE id = $1 AND es_prueba`, [id]);
  }
  return { borrados: orden.length };
}
