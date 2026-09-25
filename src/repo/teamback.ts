// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- repositorio, sección TOTALMENTE APARTE
// del resto del sistema (tablas tb_*, ver schema.sql). No importa nada de repo/catalog.ts,
// repo/closings.ts ni ningún otro repo de DigiPlayers -- el único código compartido es el
// parser crudo de archivos de Suprema (engine/importSuprema.ts), porque es el mismo formato de
// archivo, pero acá se usa para OTRA cosa (rake por jugador para el programa de afiliados, no
// para armar cierres de agentes).
import { pool, newId } from "../db/pool.js";
import {
  calcularLiquidacionSemanal,
  type TbConfig,
  type OrigenLiquidacionSemanal,
} from "../engine/teambackAffiliates.js";

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export async function getTbConfig(): Promise<TbConfig> {
  const r = await pool.query(`SELECT * FROM tb_config WHERE id = 'default'`);
  const row = r.rows[0];
  return {
    pctBase: Number(row.pct_base),
    pctTier2: Number(row.pct_tier2),
    pctTier3: Number(row.pct_tier3),
    umbralVolumenTier2Usd: Number(row.umbral_volumen_tier2_usd),
    umbralVolumenTier3Usd: Number(row.umbral_volumen_tier3_usd),
    umbralReferidosTier2: Number(row.umbral_referidos_tier2),
    umbralReferidosTier3: Number(row.umbral_referidos_tier3),
    umbralReferidoActivoUsd: Number(row.umbral_referido_activo_usd),
    pctComisionReferido: Number(row.pct_comision_referido),
    aplicarUmbralAComision: Boolean(row.aplicar_umbral_a_comision),
    ventanaActividadSemanas: Number(row.ventana_actividad_semanas),
  };
}

export interface TbConfigInput extends TbConfig {}

export async function updateTbConfig(input: TbConfigInput): Promise<TbConfig> {
  await pool.query(
    `UPDATE tb_config SET
       pct_base = $1, pct_tier2 = $2, pct_tier3 = $3,
       umbral_volumen_tier2_usd = $4, umbral_volumen_tier3_usd = $5,
       umbral_referidos_tier2 = $6, umbral_referidos_tier3 = $7,
       umbral_referido_activo_usd = $8, pct_comision_referido = $9,
       aplicar_umbral_a_comision = $10, ventana_actividad_semanas = $11,
       updated_at = now()
     WHERE id = 'default'`,
    [
      input.pctBase, input.pctTier2, input.pctTier3,
      input.umbralVolumenTier2Usd, input.umbralVolumenTier3Usd,
      input.umbralReferidosTier2, input.umbralReferidosTier3,
      input.umbralReferidoActivoUsd, input.pctComisionReferido,
      input.aplicarUmbralAComision, input.ventanaActividadSemanas,
    ]
  );
  return getTbConfig();
}

// ---------------------------------------------------------------------------------------------
// Config POR JUGADOR (25/09/2026, pedido de Leo: "deberiamos poder configurar a los jugadores y
// sus % no en general como esta ahi") -- reemplaza a tb_config como fuente real para calcular
// liquidaciones; tb_config (arriba) queda solo como plantilla para prellenar el formulario de un
// jugador nuevo. Ver el comentario en schema.sql para el detalle completo.
// ---------------------------------------------------------------------------------------------

function filaAConfig(row: any): TbConfig {
  return {
    pctBase: Number(row.pct_base),
    pctTier2: Number(row.pct_tier2),
    pctTier3: Number(row.pct_tier3),
    umbralVolumenTier2Usd: Number(row.umbral_volumen_tier2_usd),
    umbralVolumenTier3Usd: Number(row.umbral_volumen_tier3_usd),
    umbralReferidosTier2: Number(row.umbral_referidos_tier2),
    umbralReferidosTier3: Number(row.umbral_referidos_tier3),
    umbralReferidoActivoUsd: Number(row.umbral_referido_activo_usd),
    pctComisionReferido: Number(row.pct_comision_referido),
    aplicarUmbralAComision: Boolean(row.aplicar_umbral_a_comision),
    ventanaActividadSemanas: Number(row.ventana_actividad_semanas),
  };
}

/** null si el jugador todavía no tiene su propia config cargada -- NO cae al default global. */
export async function getTbPlayerConfig(playerId: string): Promise<TbConfig | null> {
  const r = await pool.query(`SELECT * FROM tb_player_config WHERE player_id = $1`, [playerId]);
  if (r.rows.length === 0) return null;
  return filaAConfig(r.rows[0]);
}

export async function upsertTbPlayerConfig(playerId: string, input: TbConfigInput): Promise<TbConfig> {
  const jugador = await getTbPlayer(playerId);
  if (!jugador) throw new Error("No se encontró ese jugador.");
  const r = await pool.query(
    `INSERT INTO tb_player_config
       (player_id, pct_base, pct_tier2, pct_tier3, umbral_volumen_tier2_usd, umbral_volumen_tier3_usd,
        umbral_referidos_tier2, umbral_referidos_tier3, umbral_referido_activo_usd, pct_comision_referido,
        aplicar_umbral_a_comision, ventana_actividad_semanas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (player_id) DO UPDATE SET
       pct_base = EXCLUDED.pct_base, pct_tier2 = EXCLUDED.pct_tier2, pct_tier3 = EXCLUDED.pct_tier3,
       umbral_volumen_tier2_usd = EXCLUDED.umbral_volumen_tier2_usd,
       umbral_volumen_tier3_usd = EXCLUDED.umbral_volumen_tier3_usd,
       umbral_referidos_tier2 = EXCLUDED.umbral_referidos_tier2,
       umbral_referidos_tier3 = EXCLUDED.umbral_referidos_tier3,
       umbral_referido_activo_usd = EXCLUDED.umbral_referido_activo_usd,
       pct_comision_referido = EXCLUDED.pct_comision_referido,
       aplicar_umbral_a_comision = EXCLUDED.aplicar_umbral_a_comision,
       ventana_actividad_semanas = EXCLUDED.ventana_actividad_semanas,
       updated_at = now()
     RETURNING *`,
    [
      playerId, input.pctBase, input.pctTier2, input.pctTier3,
      input.umbralVolumenTier2Usd, input.umbralVolumenTier3Usd,
      input.umbralReferidosTier2, input.umbralReferidosTier3,
      input.umbralReferidoActivoUsd, input.pctComisionReferido,
      input.aplicarUmbralAComision, input.ventanaActividadSemanas,
    ]
  );
  return filaAConfig(r.rows[0]);
}

/** Config de TODOS los jugadores que ya la tienen cargada, indexada por player_id -- para no
 * pegarle a la base una vez por jugador al calcular la liquidación de toda la semana. */
async function getTodasLasConfigsDeJugadores(): Promise<Map<string, TbConfig>> {
  const r = await pool.query(`SELECT * FROM tb_player_config`);
  const mapa = new Map<string, TbConfig>();
  for (const row of r.rows) mapa.set(row.player_id, filaAConfig(row));
  return mapa;
}

// ---------------------------------------------------------------------------------------------
// Jugadores / árbol de referidos
// ---------------------------------------------------------------------------------------------

export interface TbPlayerInput {
  supremaPlayerId: string;
  name: string;
  fechaAlta?: string; // YYYY-MM-DD
  referidoPorId?: string | null;
  notes?: string | null;
}

export async function listTbPlayers(includeInactive = true) {
  const r = await pool.query(
    `SELECT p.*, ref.name as referido_por_name, ref.suprema_player_id as referido_por_suprema_id,
            (SELECT COUNT(*) FROM tb_players h WHERE h.referido_por_id = p.id) as referidos_count,
            -- (25/09/2026) para que la lista pueda avisar qué jugadores todavía no tienen su %
            -- propio cargado, sin tener que pedir la config de cada uno por separado.
            EXISTS (SELECT 1 FROM tb_player_config c WHERE c.player_id = p.id) as tiene_config
     FROM tb_players p
     LEFT JOIN tb_players ref ON ref.id = p.referido_por_id
     WHERE $1 OR p.active = true
     ORDER BY p.name`,
    [includeInactive]
  );
  return r.rows;
}

export async function getTbPlayer(id: string) {
  const r = await pool.query(`SELECT * FROM tb_players WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export async function getTbPlayerBySupremaId(supremaPlayerId: string) {
  const r = await pool.query(`SELECT * FROM tb_players WHERE suprema_player_id = $1`, [supremaPlayerId]);
  return r.rows[0] ?? null;
}

export async function crearTbPlayer(input: TbPlayerInput) {
  if (input.referidoPorId) {
    const ref = await getTbPlayer(input.referidoPorId);
    if (!ref) throw new Error("El jugador que referís no existe.");
  }
  const id = newId("tbp");
  try {
    const r = await pool.query(
      `INSERT INTO tb_players (id, suprema_player_id, name, fecha_alta, referido_por_id, notes)
       VALUES ($1,$2,$3,COALESCE($4, CURRENT_DATE),$5,$6) RETURNING *`,
      [id, input.supremaPlayerId.trim(), input.name.trim(), input.fechaAlta ?? null, input.referidoPorId ?? null, input.notes ?? null]
    );
    return r.rows[0];
  } catch (err: any) {
    if (err.code === "23505") throw new Error(`Ya existe un jugador con el ID de Suprema "${input.supremaPlayerId}".`);
    throw err;
  }
}

export async function actualizarTbPlayer(id: string, input: Partial<TbPlayerInput> & { active?: boolean }) {
  if (input.referidoPorId) {
    if (input.referidoPorId === id) throw new Error("Un jugador no puede referirse a sí mismo.");
    const ref = await getTbPlayer(input.referidoPorId);
    if (!ref) throw new Error("El jugador que referís no existe.");
    // Evita ciclos: el nuevo referente no puede ser, a su vez, un referido (directo o indirecto)
    // de este jugador -- si no, el árbol dejaría de ser un árbol.
    let cursor: string | null = input.referidoPorId;
    const visitados = new Set<string>();
    while (cursor) {
      if (cursor === id) throw new Error("Ese cambio crearía un ciclo en el árbol de referidos (el referente termina siendo referido de este mismo jugador).");
      if (visitados.has(cursor)) break;
      visitados.add(cursor);
      const fila = await getTbPlayer(cursor);
      cursor = fila?.referido_por_id ?? null;
    }
  }
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  const map: Record<string, any> = {
    suprema_player_id: input.supremaPlayerId,
    name: input.name,
    fecha_alta: input.fechaAlta,
    notes: input.notes,
    active: input.active,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
  }
  // referido_por_id se trata aparte porque null es un valor válido (desvincular), a diferencia
  // de undefined (no tocar).
  if ("referidoPorId" in input) {
    sets.push(`referido_por_id = $${i++}`);
    values.push(input.referidoPorId ?? null);
  }
  if (sets.length === 0) return getTbPlayer(id);
  sets.push(`updated_at = now()`);
  values.push(id);
  const r = await pool.query(`UPDATE tb_players SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  if (r.rows.length === 0) throw new Error("No se encontró ese jugador.");
  return r.rows[0];
}

/** Árbol completo (todos los niveles) -- V1 solo paga el nivel directo, pero se expone completo
 * para que la UI lo pueda mostrar y para tenerlo listo el día que se pague un segundo nivel. */
export async function getArbolReferidos() {
  const r = await pool.query(
    `WITH RECURSIVE arbol AS (
       SELECT id, suprema_player_id, name, referido_por_id, active, 0 as nivel,
              ARRAY[id] as camino
       FROM tb_players WHERE referido_por_id IS NULL
       UNION ALL
       SELECT p.id, p.suprema_player_id, p.name, p.referido_por_id, p.active, a.nivel + 1,
              a.camino || p.id
       FROM tb_players p JOIN arbol a ON p.referido_por_id = a.id
       WHERE NOT p.id = ANY(a.camino) -- corta cualquier ciclo por las dudas, nunca debería pasar
     )
     SELECT * FROM arbol ORDER BY camino`
  );
  return r.rows;
}

// ---------------------------------------------------------------------------------------------
// Import semanal (rake por jugador, desde el archivo crudo de Suprema)
// ---------------------------------------------------------------------------------------------

export interface ImportRow {
  supremaPlayerId: string;
  supremaPlayerName: string;
  rake: number;
}

export interface ImportPreviewResultado {
  conocidos: { player: any; rake: number }[];
  desconocidos: { supremaPlayerId: string; supremaPlayerName: string; rake: number }[];
}

/** Solo clasifica -- no toca la base. La UI muestra "desconocidos" para que se den de alta a
 * mano (con su referido_por_id, si corresponde) antes de importar esos. */
export async function previsualizarImportSemana(rows: ImportRow[]): Promise<ImportPreviewResultado> {
  const conocidos: ImportPreviewResultado["conocidos"] = [];
  const desconocidos: ImportPreviewResultado["desconocidos"] = [];
  for (const row of rows) {
    const player = await getTbPlayerBySupremaId(row.supremaPlayerId);
    if (player) conocidos.push({ player, rake: row.rake });
    else desconocidos.push({ supremaPlayerId: row.supremaPlayerId, supremaPlayerName: row.supremaPlayerName, rake: row.rake });
  }
  return { conocidos, desconocidos };
}

/** Importa el rake de la semana SOLO para jugadores ya dados de alta (los "conocidos" de la
 * previa) -- upsert por jugador+semana, así se puede reimportar sin duplicar si el archivo se
 * corrige. */
export async function importarSemana(weekStart: string, weekEnd: string, rows: ImportRow[], importSource?: string) {
  let importados = 0;
  let saltados = 0;
  for (const row of rows) {
    const player = await getTbPlayerBySupremaId(row.supremaPlayerId);
    if (!player) {
      saltados++;
      continue;
    }
    await pool.query(
      `INSERT INTO tb_weekly_stats (id, player_id, week_start, week_end, rake_bruto, import_source)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (player_id, week_start) DO UPDATE SET rake_bruto = EXCLUDED.rake_bruto, week_end = EXCLUDED.week_end, import_source = EXCLUDED.import_source`,
      [newId("tbw"), player.id, weekStart, weekEnd, row.rake, importSource ?? null]
    );
    importados++;
  }
  return { importados, saltados };
}

// ---------------------------------------------------------------------------------------------
// Liquidación semanal
// ---------------------------------------------------------------------------------------------

async function rakePropioDeSemanasAnteriores(playerId: string, weekStart: string, cantidadSemanas: number): Promise<number[]> {
  const r = await pool.query(
    `SELECT rake_bruto FROM tb_weekly_stats
     WHERE player_id = $1 AND week_start < $2::date
     ORDER BY week_start DESC LIMIT $3`,
    [playerId, weekStart, cantidadSemanas]
  );
  return r.rows.map((row) => Number(row.rake_bruto));
}

async function rakeDeReferidosDirectos(playerId: string, weekStart: string): Promise<number[]> {
  const r = await pool.query(
    `SELECT COALESCE(s.rake_bruto, 0) as rake
     FROM tb_players p
     LEFT JOIN tb_weekly_stats s ON s.player_id = p.id AND s.week_start = $2::date
     WHERE p.referido_por_id = $1`,
    [playerId, weekStart]
  );
  return r.rows.map((row) => Number(row.rake));
}

/** Calcula (y persiste) la liquidación de TODOS los jugadores activos que tengan algo para
 * liquidar esa semana (rake propio esa semana, o al menos un referido directo con rake esa
 * semana -- si no, no genera fila, para no ensuciar el histórico con ceros de jugadores
 * totalmente inactivos). Upsert por jugador+semana -- se puede recalcular sin duplicar.
 *
 * (25/09/2026) Cada jugador usa SU PROPIA config (tb_player_config), no un default global -- si
 * un jugador con algo para liquidar todavía no tiene la suya cargada, se lo salta (no se le
 * inventa un % por defecto) y queda listado en `sinConfigurar` para que se sepa y se cargue. */
export async function calcularYGuardarLiquidacionSemana(weekStart: string, weekEnd: string) {
  const configsPorJugador = await getTodasLasConfigsDeJugadores();
  const jugadores = await pool.query(`SELECT * FROM tb_players WHERE active = true`);

  const resultados: any[] = [];
  const sinConfigurar: { playerId: string; playerName: string; supremaPlayerId: string }[] = [];
  for (const jugador of jugadores.rows) {
    const statsPropia = await pool.query(
      `SELECT rake_bruto FROM tb_weekly_stats WHERE player_id = $1 AND week_start = $2::date`,
      [jugador.id, weekStart]
    );
    const rakePropio = Number(statsPropia.rows[0]?.rake_bruto ?? 0);
    const rakeReferidosDirectos = await rakeDeReferidosDirectos(jugador.id, weekStart);

    if (rakePropio === 0 && rakeReferidosDirectos.every((r) => r === 0)) continue; // nada que liquidar

    const cfg = configsPorJugador.get(jugador.id);
    if (!cfg) {
      sinConfigurar.push({ playerId: jugador.id, playerName: jugador.name, supremaPlayerId: jugador.suprema_player_id });
      continue;
    }

    const rakePropioSemanasAnteriores = await rakePropioDeSemanasAnteriores(jugador.id, weekStart, cfg.ventanaActividadSemanas);
    const origen: OrigenLiquidacionSemanal = { rakePropio, rakeReferidosDirectos, rakePropioSemanasAnteriores };
    const calc = calcularLiquidacionSemanal(origen, cfg);

    const r = await pool.query(
      `INSERT INTO tb_weekly_liquidations
         (id, player_id, week_start, week_end, rake_propio, referidos_activos_count, tier_alcanzado_por,
          rakeback_pct, rakeback_generado, rake_referidos_directos, comision_3pct_bruta,
          comision_3pct_pausada, comision_3pct_acreditada, total_acreditado, activo_en_ventana, config_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (player_id, week_start) DO UPDATE SET
         week_end = EXCLUDED.week_end, rake_propio = EXCLUDED.rake_propio,
         referidos_activos_count = EXCLUDED.referidos_activos_count, tier_alcanzado_por = EXCLUDED.tier_alcanzado_por,
         rakeback_pct = EXCLUDED.rakeback_pct, rakeback_generado = EXCLUDED.rakeback_generado,
         rake_referidos_directos = EXCLUDED.rake_referidos_directos, comision_3pct_bruta = EXCLUDED.comision_3pct_bruta,
         comision_3pct_pausada = EXCLUDED.comision_3pct_pausada, comision_3pct_acreditada = EXCLUDED.comision_3pct_acreditada,
         total_acreditado = EXCLUDED.total_acreditado, activo_en_ventana = EXCLUDED.activo_en_ventana,
         config_snapshot = EXCLUDED.config_snapshot
       RETURNING *`,
      [
        newId("tbl"), jugador.id, weekStart, weekEnd,
        calc.rakePropio, calc.referidosActivosCount, calc.tierAlcanzadoPor,
        calc.rakebackPct, calc.rakebackGenerado, calc.rakeReferidosDirectos, calc.comision3pctBruta,
        calc.comision3pctPausada, calc.comision3pctAcreditada, calc.totalAcreditado, calc.activoEnVentana,
        JSON.stringify(cfg),
      ]
    );
    resultados.push({ ...r.rows[0], player_name: jugador.name, suprema_player_id: jugador.suprema_player_id });
  }
  return { resultados, sinConfigurar };
}

export async function getLiquidacionesSemana(weekStart: string) {
  const r = await pool.query(
    `SELECT l.*, p.name as player_name, p.suprema_player_id
     FROM tb_weekly_liquidations l JOIN tb_players p ON p.id = l.player_id
     WHERE l.week_start = $1::date ORDER BY p.name`,
    [weekStart]
  );
  return r.rows;
}

export async function getSemanasDisponibles() {
  const r = await pool.query(`SELECT DISTINCT week_start, week_end FROM tb_weekly_liquidations ORDER BY week_start DESC`);
  return r.rows;
}

export async function getHistorialJugador(playerId: string) {
  const r = await pool.query(
    `SELECT * FROM tb_weekly_liquidations WHERE player_id = $1 ORDER BY week_start DESC`,
    [playerId]
  );
  return r.rows;
}

/** Liquidación individual lista para copiar/mandarle al jugador -- mismo formato que pidió Leo. */
export async function getLiquidacionIndividual(playerId: string, weekStart: string) {
  const player = await getTbPlayer(playerId);
  if (!player) throw new Error("No se encontró ese jugador.");
  const r = await pool.query(
    `SELECT * FROM tb_weekly_liquidations WHERE player_id = $1 AND week_start = $2::date`,
    [playerId, weekStart]
  );
  const liq = r.rows[0];
  if (!liq) throw new Error("No hay liquidación calculada para ese jugador en esa semana.");
  return { player, liquidacion: liq };
}
