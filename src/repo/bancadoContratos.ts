// Repo de "Bancado — Contratos" (pedido Leo 02/10/2026). Dos reglas 100% configurables por
// contrato, nunca un default implícito -- ver comentario grande en db/schema.sql y en
// engine/bancadoContrato.ts. Este módulo es independiente de los dos sistemas de bancado que ya
// existían (agents.account_type='BANCADO' y "Jugadores bancados" / bancado_config) -- ninguna
// función de acá los toca ni los lee.
import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";
import { calcularCierreBancado as calcularCierreBancadoRmf, type BancadoConfig as BancadoConfigRmf, type BancadoEstado as BancadoEstadoRmf } from "../engine/bancados.js";
import {
  calcularParcialSemanal,
  calcularRecuperacionYSplit,
  calcularSplitExtraordinario,
  calcularGananciaTeamback,
  calcularCreditoPendiente,
  type BancadoV1Config,
  type ModoMemoria,
} from "../engine/bancadoContrato.js";

export type ReglaKey = "RMF" | "REGLA_BANCADO_V1";

// ---------------------------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------------------------
export interface CrearContratoInput {
  // Exactamente uno de los dos (pedido Leo 02/10/2026: elegir de la lista de jugadores/agentes
  // que ya existen en el sistema, nunca escribir el nombre a mano) -- ver bancado_contratos_
  // jugador_o_agente_check en db/schema.sql.
  playerId?: string | null;
  agentId?: string | null;
  clubId?: string | null;
  moneda?: string;
  reglaKey: ReglaKey;
  observaciones?: string | null;
  // RMF
  rmfPctJugador?: number;
  rmfPctBanca?: number;
  rmfRakebackPct?: number;
  rmfRakebackBancaPct?: number;
  rmfUnionSharePct?: number;
  rmfCapitalInicial?: number;
  rmfMakeupInicial?: number;
  // REGLA_BANCADO_V1
  v1RakeDealPct?: number;
  v1RakeTeambackDirectoPct?: number;
  v1SplitJugadorPct?: number;
  v1SplitTeambackPct?: number;
  v1ModoMemoriaDefault?: ModoMemoria;
}

function validarParametrosContrato(input: CrearContratoInput) {
  if (!!input.playerId === !!input.agentId) {
    throw new Error("Hay que elegir exactamente un jugador O un agente de la lista -- no ambos, no ninguno.");
  }
  if (input.reglaKey === "RMF") {
    if (input.rmfPctJugador === undefined || input.rmfPctBanca === undefined || input.rmfRakebackPct === undefined) {
      throw new Error("La regla RMF necesita rmfPctJugador, rmfPctBanca y rmfRakebackPct -- no hay valores default.");
    }
  } else {
    if (
      input.v1RakeDealPct === undefined ||
      input.v1RakeTeambackDirectoPct === undefined ||
      input.v1SplitJugadorPct === undefined ||
      input.v1SplitTeambackPct === undefined
    ) {
      throw new Error(
        "REGLA_BANCADO_V1 necesita v1RakeDealPct, v1RakeTeambackDirectoPct, v1SplitJugadorPct y v1SplitTeambackPct -- no hay valores default (sección 1 del documento)."
      );
    }
  }
}

// Lista combinada para el selector (pedido Leo 02/10/2026) -- jugadores Y agentes ya cargados
// en el sistema, cada uno marcado con su "tipo" para no confundirlos en el combo.
export async function listCandidatosBancado() {
  // "players" esta scopeado por club (UNIQUE(club_id, external_id)) -- el mismo jugador real que
  // juega en varios clubes tiene una fila distinta por cada club, todas con el mismo nombre. Sin
  // el club al lado, el selector los muestra repetidos sin forma de distinguir cual es cual
  // (bug reportado por Leo 02/10/2026) -- por eso acá se trae club_name para poder desambiguar.
  const r = await pool.query(
    `SELECT p.id, 'PLAYER' AS tipo, COALESCE(p.display_name, p.external_id) AS nombre, p.club_id, c.name AS club_name
       FROM players p JOIN clubs c ON c.id = p.club_id
     UNION ALL
     SELECT a.id, 'AGENT' AS tipo, a.name AS nombre, NULL::text AS club_id, NULL::text AS club_name
       FROM agents a WHERE a.active
     ORDER BY nombre ASC`
  );
  return r.rows;
}

export async function crearContrato(input: CrearContratoInput, createdBy?: string | null) {
  validarParametrosContrato(input);
  const id = newId("bct");
  const r = await pool.query(
    `INSERT INTO bancado_contratos
      (id, player_id, agent_id, club_id, moneda, regla_key, observaciones, created_by,
       rmf_pct_jugador, rmf_pct_banca, rmf_rakeback_pct, rmf_rakeback_banca_pct, rmf_union_share_pct,
       rmf_capital_inicial, rmf_makeup_inicial,
       v1_rake_deal_pct, v1_rake_teamback_directo_pct, v1_split_jugador_pct, v1_split_teamback_pct, v1_modo_memoria_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      id,
      input.playerId ?? null,
      input.agentId ?? null,
      input.clubId ?? null,
      input.moneda ?? "USD",
      input.reglaKey,
      input.observaciones ?? null,
      createdBy ?? null,
      input.reglaKey === "RMF" ? input.rmfPctJugador : null,
      input.reglaKey === "RMF" ? input.rmfPctBanca : null,
      input.reglaKey === "RMF" ? input.rmfRakebackPct : null,
      input.reglaKey === "RMF" ? input.rmfRakebackBancaPct ?? 0 : null,
      input.reglaKey === "RMF" ? input.rmfUnionSharePct ?? 0 : null,
      input.reglaKey === "RMF" ? input.rmfCapitalInicial ?? 0 : null,
      input.reglaKey === "RMF" ? input.rmfMakeupInicial ?? 0 : null,
      input.reglaKey === "REGLA_BANCADO_V1" ? input.v1RakeDealPct : null,
      input.reglaKey === "REGLA_BANCADO_V1" ? input.v1RakeTeambackDirectoPct : null,
      input.reglaKey === "REGLA_BANCADO_V1" ? input.v1SplitJugadorPct : null,
      input.reglaKey === "REGLA_BANCADO_V1" ? input.v1SplitTeambackPct : null,
      input.reglaKey === "REGLA_BANCADO_V1" ? input.v1ModoMemoriaDefault ?? "AUTOMATICO" : null,
    ]
  );
  return getContrato(id);
}

export interface EditarContratoInput {
  clubId?: string | null;
  observaciones?: string | null;
  activo?: boolean;
  rmfPctJugador?: number;
  rmfPctBanca?: number;
  rmfRakebackPct?: number;
  rmfRakebackBancaPct?: number;
  rmfUnionSharePct?: number;
  // Solo se pueden tocar mientras el contrato todavía no tiene ningún cierre RMF aplicado --
  // una vez que hubo un cierre, "capital actual" se deriva de ESE historial (getEstadoRmf /
  // ContratoRmf.tsx), así que cambiar el inicial después dejaría el historial ya aplicado
  // inconsistente con lo que muestra la pantalla.
  rmfCapitalInicial?: number;
  rmfMakeupInicial?: number;
  v1RakeDealPct?: number;
  v1RakeTeambackDirectoPct?: number;
  v1SplitJugadorPct?: number;
  v1SplitTeambackPct?: number;
  v1ModoMemoriaDefault?: ModoMemoria;
}

// No se puede cambiar regla_key NI el jugador/agente vinculado de un contrato ya creado -- si
// cambia el contrato de verdad (como el caso de Matías), se crea un contrato nuevo (así queda
// clarísimo en el historial cuál liquidación corresponde a qué reglas, y nunca se mezclan
// parámetros de una regla con la otra).
export async function editarContrato(id: string, input: EditarContratoInput, editadoPor?: string | null) {
  const actual = await getContrato(id);
  if (!actual) throw new Error("Contrato no encontrado.");
  let rmfCapitalInicial = actual.rmf_capital_inicial;
  let rmfMakeupInicial = actual.rmf_makeup_inicial;
  if (actual.regla_key === "RMF" && (input.rmfCapitalInicial !== undefined || input.rmfMakeupInicial !== undefined)) {
    const yaCerro = await pool.query(`SELECT 1 FROM bancado_contrato_rmf_cierres WHERE contrato_id = $1 LIMIT 1`, [id]);
    if (yaCerro.rows.length > 0) {
      throw new Error("Este contrato ya tiene cierres RMF aplicados -- el capital/makeup inicial no se puede cambiar ahora (se arrastraría mal el historial ya cerrado). Si fue mal cargado, hay que revertir los cierres primero.");
    }
    rmfCapitalInicial = input.rmfCapitalInicial ?? rmfCapitalInicial;
    rmfMakeupInicial = input.rmfMakeupInicial ?? rmfMakeupInicial;
  }
  await pool.query(
    `UPDATE bancado_contratos SET
       club_id = $1, observaciones = $2, activo = $3,
       rmf_pct_jugador = $4, rmf_pct_banca = $5, rmf_rakeback_pct = $6, rmf_rakeback_banca_pct = $7, rmf_union_share_pct = $8,
       rmf_capital_inicial = $9, rmf_makeup_inicial = $10,
       v1_rake_deal_pct = $11, v1_rake_teamback_directo_pct = $12,
       v1_split_jugador_pct = $13, v1_split_teamback_pct = $14, v1_modo_memoria_default = $15,
       updated_at = now(), updated_by = COALESCE($16, updated_by)
     WHERE id = $17`,
    [
      input.clubId !== undefined ? input.clubId : actual.club_id,
      input.observaciones !== undefined ? input.observaciones : actual.observaciones,
      input.activo !== undefined ? input.activo : actual.activo,
      actual.regla_key === "RMF" ? input.rmfPctJugador ?? actual.rmf_pct_jugador : null,
      actual.regla_key === "RMF" ? input.rmfPctBanca ?? actual.rmf_pct_banca : null,
      actual.regla_key === "RMF" ? input.rmfRakebackPct ?? actual.rmf_rakeback_pct : null,
      actual.regla_key === "RMF" ? input.rmfRakebackBancaPct ?? actual.rmf_rakeback_banca_pct : null,
      actual.regla_key === "RMF" ? input.rmfUnionSharePct ?? actual.rmf_union_share_pct : null,
      actual.regla_key === "RMF" ? rmfCapitalInicial : null,
      actual.regla_key === "RMF" ? rmfMakeupInicial : null,
      actual.regla_key === "REGLA_BANCADO_V1" ? input.v1RakeDealPct ?? actual.v1_rake_deal_pct : null,
      actual.regla_key === "REGLA_BANCADO_V1" ? input.v1RakeTeambackDirectoPct ?? actual.v1_rake_teamback_directo_pct : null,
      actual.regla_key === "REGLA_BANCADO_V1" ? input.v1SplitJugadorPct ?? actual.v1_split_jugador_pct : null,
      actual.regla_key === "REGLA_BANCADO_V1" ? input.v1SplitTeambackPct ?? actual.v1_split_teamback_pct : null,
      actual.regla_key === "REGLA_BANCADO_V1" ? input.v1ModoMemoriaDefault ?? actual.v1_modo_memoria_default : null,
      editadoPor ?? null,
      id,
    ]
  );
  return getContrato(id);
}

// Borrado de contrato (pedido Leo 05/10/2026, ampliado 05/10/2026 "no importa que tenga
// liquidaciones realizadas, ya que ahora como estamos probando y analizando"): borra el
// contrato Y todo su historial en cascada (períodos, parciales, liquidaciones, ajustes, costos
// fijos, cierres RMF). A diferencia del resto del sistema (ledger, adelantos, cierres
// semanales), este módulo de Bancado Contratos NO genera ningún movimiento de Wallet/Tesorería
// propio -- todo lo que crea vive únicamente en estas tablas bancado_contrato_* -- así que
// borrarlo no deja nada huérfano en el ledger real. Mientras el módulo esté en etapa de prueba
// esto queda sin bloqueo; si en algún momento pasa a operar con plata real en serio, achicar
// esto a un bloqueo (como adelantos/ledger) o a un soft-delete es lo que correspondería.
export async function eliminarContrato(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const actual = await client.query(`SELECT 1 FROM bancado_contratos WHERE id = $1 FOR UPDATE`, [id]);
    if (actual.rows.length === 0) throw new Error("Contrato no encontrado.");
    await client.query(`DELETE FROM bancado_contrato_ajustes WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contrato_parciales WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contrato_liquidaciones WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contrato_costos_fijos WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contrato_rmf_cierres WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contrato_periodos WHERE contrato_id = $1`, [id]);
    await client.query(`DELETE FROM bancado_contratos WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// El nombre a mostrar sale del jugador/agente vinculado, nunca de un campo de texto cargado a
// mano -- bc.nombre queda solo como respaldo si algún día ese vínculo se pierde.
const SELECT_CONTRATO = `
  SELECT bc.*,
         COALESCE(pl.display_name, pl.external_id, ag.name, bc.nombre, 'Sin nombre') AS nombre,
         CASE WHEN bc.player_id IS NOT NULL THEN 'PLAYER' WHEN bc.agent_id IS NOT NULL THEN 'AGENT' END AS tipo_vinculo
  FROM bancado_contratos bc
  LEFT JOIN players pl ON pl.id = bc.player_id
  LEFT JOIN agents ag ON ag.id = bc.agent_id
`;

export async function listContratos() {
  const r = await pool.query(
    `${SELECT_CONTRATO} ORDER BY bc.activo DESC, COALESCE(pl.display_name, pl.external_id, ag.name, bc.nombre, 'Sin nombre') ASC`
  );
  return r.rows;
}

export async function getContrato(id: string) {
  const r = await pool.query(`${SELECT_CONTRATO} WHERE bc.id = $1`, [id]);
  return r.rows[0] ?? null;
}

function cfgV1(contrato: any): BancadoV1Config {
  return {
    rakeDealPct: Number(contrato.v1_rake_deal_pct),
    rakeTeambackDirectoPct: Number(contrato.v1_rake_teamback_directo_pct),
    splitJugadorPct: Number(contrato.v1_split_jugador_pct),
    splitTeambackPct: Number(contrato.v1_split_teamback_pct),
  };
}

// ---------------------------------------------------------------------------------------------
// Períodos (solo REGLA_BANCADO_V1) -- secciones 9, 10, 27, 28
// ---------------------------------------------------------------------------------------------
export async function listPeriodos(contratoId: string) {
  const r = await pool.query(
    `SELECT * FROM bancado_contrato_periodos WHERE contrato_id = $1 ORDER BY anio DESC, mes DESC`,
    [contratoId]
  );
  return r.rows;
}

export async function getPeriodo(id: string) {
  const r = await pool.query(`SELECT * FROM bancado_contrato_periodos WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

export interface AbrirPeriodoInput {
  contratoId: string;
  anio: number;
  mes: number;
  memoriaInicial?: number; // obligatorio si es el primer período del contrato
  modoMemoria?: ModoMemoria; // default = contrato.v1_modo_memoria_default
}

export async function abrirPeriodo(input: AbrirPeriodoInput) {
  const contrato = await getContrato(input.contratoId);
  if (!contrato) throw new Error("Contrato no encontrado.");
  if (contrato.regla_key !== "REGLA_BANCADO_V1") {
    throw new Error("Este contrato usa la regla RMF -- RMF liquida semana a semana, no tiene períodos mensuales.");
  }
  const existing = await pool.query(
    `SELECT id FROM bancado_contrato_periodos WHERE contrato_id = $1 AND anio = $2 AND mes = $3`,
    [input.contratoId, input.anio, input.mes]
  );
  if (existing.rows.length > 0) throw new Error("Ya existe un período para ese mes de este contrato.");

  // Sección 28: el período nuevo arranca con la memoria final del anterior (si hay uno
  // cerrado) -- nunca se recalcula desde cero. Si es el primer período del contrato, la
  // memoria inicial la tiene que dar quien abre el período a mano (ej. los USD 344,75 de
  // Matías migrados del acuerdo viejo) -- no hay forma de inventarla sola.
  let memoriaInicial = input.memoriaInicial;
  const previoRes = await pool.query(
    `SELECT * FROM bancado_contrato_periodos WHERE contrato_id = $1 AND (anio < $2 OR (anio = $2 AND mes < $3))
     ORDER BY anio DESC, mes DESC LIMIT 1`,
    [input.contratoId, input.anio, input.mes]
  );
  const previo = previoRes.rows[0] ?? null;
  if (memoriaInicial === undefined) {
    if (!previo) {
      throw new Error("Es el primer período de este contrato -- hay que indicar la memoria inicial a mano.");
    }
    if (previo.estado !== "CERRADO") {
      throw new Error(`El período anterior (${previo.anio}-${previo.mes}) todavía está ABIERTO -- cerralo antes de abrir uno nuevo.`);
    }
    memoriaInicial = Number(previo.memoria_final);
  }

  const id = newId("bper");
  const r = await pool.query(
    `INSERT INTO bancado_contrato_periodos (id, contrato_id, anio, mes, memoria_inicial, memoria_actual, modo_memoria)
     VALUES ($1,$2,$3,$4,$5,$5,$6) RETURNING *`,
    [id, input.contratoId, input.anio, input.mes, memoriaInicial, input.modoMemoria ?? contrato.v1_modo_memoria_default ?? "AUTOMATICO"]
  );
  return r.rows[0];
}

export interface ReabrirPeriodoInput {
  periodoId: string;
  motivo: string;
  reabiertoPor: string;
}

// Sección 28: reapertura ADMINISTRATIVA AUDITADA -- nunca silenciosa. No se puede reabrir si ya
// existe un período más nuevo de este contrato (ese ya puede haber heredado la memoria_final de
// este, reabrir desordenado puede desincronizar la cadena de memoria).
// FIX 05/10/2026 (bug encontrado en análisis, confirmado por Leo "sí, dejame ver la semana
// cerrada"): antes, reabrir un período CERRADO solo cambiaba el estado -- no deshacía nada del
// cierre mensual que lo generó. El cierre mensual (ejecutarCierreMensual) NUNCA incrementa
// resultado_ya_distribuido (a propósito: un período CERRADO es terminal, nada vuelve a leer ese
// campo). Pero si se reabre, se carga un parcial nuevo y se vuelve a cerrar, calcularPendiente
// vuelve a contar TODO el resultado acumulado del período como si nada se hubiera repartido
// todavía -- repartiendo (pagando) dos veces el split que ya se había pagado en el primer
// cierre. Acá es donde se corrige: al reabrir, la liquidación MENSUAL todavía activa de este
// período se revierte (status='REVERTIDO', nunca se borra) y su base_liberada_split (lo que ya
// se repartió) se suma a resultado_ya_distribuido -- así un cierre posterior solo reparte la
// plata NUEVA que entró después de la reapertura. memoria_actual NO se toca: ya refleja
// correctamente toda la recuperación acumulada hasta ahora (mismo mecanismo que la proyección
// en vivo), así que no hay nada que revertir ahí. El ajuste PAGO_PENDIENTE que haya generado
// ese cierre (si hubo diferencia entre pago teórico y real) también se marca revertido, porque
// queda ligado a un cierre que ya no existe como tal.
export async function reabrirPeriodo(input: ReabrirPeriodoInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodoRes = await client.query(`SELECT * FROM bancado_contrato_periodos WHERE id = $1 FOR UPDATE`, [input.periodoId]);
    const periodo = periodoRes.rows[0];
    if (!periodo) throw new Error("Período no encontrado.");
    if (periodo.estado !== "CERRADO") throw new Error("El período ya está abierto.");
    const siguiente = await client.query(
      `SELECT id FROM bancado_contrato_periodos WHERE contrato_id = $1 AND (anio > $2 OR (anio = $2 AND mes > $3)) LIMIT 1`,
      [periodo.contrato_id, periodo.anio, periodo.mes]
    );
    if (siguiente.rows.length > 0) {
      throw new Error("Ya existe un período posterior de este contrato -- cerralo (o revisá la cadena de memoria) antes de reabrir este.");
    }

    const liqRes = await client.query(
      `SELECT * FROM bancado_contrato_liquidaciones
       WHERE periodo_id = $1 AND tipo = 'MENSUAL' AND status = 'APLICADO'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [input.periodoId]
    );
    const liquidacion = liqRes.rows[0] ?? null;

    if (liquidacion) {
      await client.query(
        `UPDATE bancado_contrato_periodos SET resultado_ya_distribuido = resultado_ya_distribuido + $1 WHERE id = $2`,
        [liquidacion.base_liberada_split, input.periodoId]
      );
      await client.query(`UPDATE bancado_contrato_liquidaciones SET status = 'REVERTIDO' WHERE id = $1`, [liquidacion.id]);
      await client.query(
        `UPDATE bancado_contrato_ajustes SET estado = 'REVERTIDO', resuelto_en = now(), resuelto_por = $1
         WHERE liquidacion_origen_id = $2 AND tipo = 'PAGO_PENDIENTE' AND estado <> 'REVERTIDO'`,
        [input.reabiertoPor, liquidacion.id]
      );
    }

    const r = await client.query(
      `UPDATE bancado_contrato_periodos SET estado = 'ABIERTO', reabierto_en = now(), reabierto_por = $1, reabierto_motivo = $2 WHERE id = $3 RETURNING *`,
      [input.reabiertoPor, input.motivo, input.periodoId]
    );
    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Parciales semanales (sección 7/8) -- nunca liquidan, nunca tocan memoria
// ---------------------------------------------------------------------------------------------
export interface RegistrarParcialInput {
  periodoId: string;
  desde: string;
  hasta: string;
  resultadoMesas: number;
  rakeBruto: number;
  ajuste?: number;
  ajusteNota?: string | null;
  observaciones?: string | null;
}

export async function registrarParcial(input: RegistrarParcialInput, createdBy?: string | null) {
  const periodo = await getPeriodo(input.periodoId);
  if (!periodo) throw new Error("Período no encontrado.");
  if (periodo.estado !== "ABIERTO") throw new Error("El período está CERRADO -- no se pueden cargar más parciales (reabrilo si hace falta corregir algo).");
  if (input.hasta < input.desde) throw new Error("La fecha \"hasta\" no puede ser anterior a \"desde\".");
  // Pedido Leo 05/10/2026: evitar cargar la misma semana dos veces por error, que duplicaba en
  // silencio el resultado y el rake acumulado del período.
  const solapado = await pool.query(
    `SELECT id, desde, hasta FROM bancado_contrato_parciales WHERE periodo_id = $1 AND desde <= $3 AND hasta >= $2 LIMIT 1`,
    [input.periodoId, input.desde, input.hasta]
  );
  if (solapado.rows.length > 0) {
    const ex = solapado.rows[0];
    throw new Error(`Ya existe un parcial que se superpone con esas fechas (${ex.desde} a ${ex.hasta}) -- borralo primero si hay que corregirlo.`);
  }
  const contrato = await getContrato(periodo.contrato_id);
  const calc = calcularParcialSemanal(cfgV1(contrato), {
    resultadoMesas: input.resultadoMesas,
    rakeBruto: input.rakeBruto,
    ajuste: input.ajuste,
  });
  const id = newId("bpar");
  const r = await pool.query(
    `INSERT INTO bancado_contrato_parciales
       (id, periodo_id, contrato_id, desde, hasta, resultado_mesas, rake_bruto, ajuste, ajuste_nota,
        rake_deal_semana, resultado_deal_semana, rake_teamback_semana, observaciones, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      id,
      input.periodoId,
      periodo.contrato_id,
      input.desde,
      input.hasta,
      input.resultadoMesas,
      input.rakeBruto,
      input.ajuste ?? 0,
      input.ajusteNota ?? null,
      calc.rakeDealSemana,
      calc.resultadoDealSemana,
      calc.rakeTeambackSemana,
      input.observaciones ?? null,
      createdBy ?? null,
    ]
  );
  return r.rows[0];
}

export async function listParciales(periodoId: string) {
  const r = await pool.query(`SELECT * FROM bancado_contrato_parciales WHERE periodo_id = $1 ORDER BY desde ASC`, [periodoId]);
  return r.rows;
}

// Borrado de un parcial mal cargado (pedido Leo 05/10/2026): a diferencia de un cierre
// (liquidación), un parcial NUNCA liquida ni toca memoria (sección 7/8) -- es solo el dato
// crudo de producción de esa semana, todavía no consolidado en nada. Por eso, mientras el
// período siga ABIERTO, borrarlo de verdad es seguro (no deja ningún rastro de un pago o un
// movimiento de memoria huérfano, porque nunca generó ninguno). Si el período ya está CERRADO
// no se puede -- hay que reabrirlo primero (reabrirPeriodo ya revierte lo que corresponda).
export async function eliminarParcial(parcialId: string) {
  const r = await pool.query(
    `SELECT p.id, per.estado FROM bancado_contrato_parciales p
     JOIN bancado_contrato_periodos per ON per.id = p.periodo_id
     WHERE p.id = $1`,
    [parcialId]
  );
  if (r.rows.length === 0) throw new Error("Parcial no encontrado.");
  if (r.rows[0].estado !== "ABIERTO") throw new Error("El período ya está CERRADO -- reabrilo primero para poder borrar un parcial.");
  await pool.query(`DELETE FROM bancado_contrato_parciales WHERE id = $1`, [parcialId]);
}

// Acumulados del período (sección 9) -- siempre desde los parciales guardados, nunca
// recalculado "a mano" en el cliente.
async function acumuladosPeriodo(periodoId: string, client?: PoolClient) {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const r = await q(
    `SELECT
       COALESCE(SUM(resultado_mesas),0) AS resultado_mesas_acumulado,
       COALESCE(SUM(rake_bruto),0) AS rake_bruto_acumulado,
       COALESCE(SUM(rake_deal_semana),0) AS rake_deal_acumulado,
       COALESCE(SUM(resultado_deal_semana),0) AS resultado_deal_acumulado,
       COALESCE(SUM(rake_teamback_semana),0) AS rake_teamback_acumulado
     FROM bancado_contrato_parciales WHERE periodo_id = $1`,
    [periodoId]
  );
  const row = r.rows[0];
  return {
    resultadoMesasAcumulado: Number(row.resultado_mesas_acumulado),
    rakeBrutoAcumulado: Number(row.rake_bruto_acumulado),
    rakeDealAcumulado: Number(row.rake_deal_acumulado),
    resultadoDealAcumulado: Number(row.resultado_deal_acumulado),
    rakeTeambackAcumulado: Number(row.rake_teamback_acumulado),
  };
}

// "pendiente a procesar" (ver comentario grande en engine/bancadoContrato.ts): neto de lo que
// ya se haya resuelto en eventos previos del período (extraordinarios).
function calcularPendiente(periodo: any, resultadoDealAcumulado: number): number {
  const memoriaYaAplicada = Number(periodo.memoria_inicial) - Number(periodo.memoria_actual);
  return resultadoDealAcumulado - memoriaYaAplicada - Number(periodo.resultado_ya_distribuido);
}

// Pantalla del período mensual (sección 31) -- memoria, producción, TeamBack, split y pagos,
// todo PROYECTADO mientras el período esté abierto (nunca es la liquidación definitiva).
export async function getEstadoPeriodo(periodoId: string) {
  const periodo = await getPeriodo(periodoId);
  if (!periodo) throw new Error("Período no encontrado.");
  const contrato = await getContrato(periodo.contrato_id);
  const acumulados = await acumuladosPeriodo(periodoId);
  const pendiente = calcularPendiente(periodo, acumulados.resultadoDealAcumulado);

  // La proyección siempre asume recuperación automática al máximo posible -- PARCIAL_MANUAL
  // solo tiene sentido como decisión deliberada al momento de cerrar (sección 15), no como
  // supuesto de una pantalla informativa.
  const proyeccion = calcularRecuperacionYSplit({
    pendiente,
    memoriaActual: Number(periodo.memoria_actual),
    modoMemoria: "AUTOMATICO",
    splitCfg: cfgV1(contrato),
  });

  const liquidacionesExtra = await pool.query(
    `SELECT COALESCE(SUM(split_teamback),0) AS teamback_split_realizado
     FROM bancado_contrato_liquidaciones WHERE periodo_id = $1 AND status = 'APLICADO'`,
    [periodoId]
  );
  const gananciaTeambackRealizada = Number(liquidacionesExtra.rows[0].teamback_split_realizado);

  return {
    periodo,
    contrato,
    acumulados,
    pendiente,
    memoriaProyectada: proyeccion.memoriaFinal,
    resultadoProyectadoParaSplit: proyeccion.resultadoParaSplit,
    splitJugadorProyectado: proyeccion.splitJugador,
    splitTeambackProyectado: proyeccion.splitTeamback,
    gananciaTeambackAcumuladaRake: acumulados.rakeTeambackAcumulado,
    gananciaTeambackRealizada,
    gananciaTeambackProyectada: acumulados.rakeTeambackAcumulado + proyeccion.splitTeamback + gananciaTeambackRealizada,
  };
}

// ---------------------------------------------------------------------------------------------
// Split extraordinario (sección 17/18) -- operación manual autorizada
// ---------------------------------------------------------------------------------------------
export interface SplitExtraordinarioInput {
  periodoId: string;
  gananciaDisponible?: number; // si no se manda, se sugiere el "pendiente" calculado ahora
  memoriaAplicada: number;
  autorizadoPor: string;
  motivo: string;
  observaciones?: string | null;
  pagoReal?: number;
}

export async function ejecutarSplitExtraordinario(input: SplitExtraordinarioInput, createdBy?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodoRes = await client.query(`SELECT * FROM bancado_contrato_periodos WHERE id = $1 FOR UPDATE`, [input.periodoId]);
    const periodo = periodoRes.rows[0];
    if (!periodo) throw new Error("Período no encontrado.");
    if (periodo.estado !== "ABIERTO") throw new Error("El período ya está CERRADO.");
    const contrato = await getContrato(periodo.contrato_id);

    const acumulados = await acumuladosPeriodo(input.periodoId, client);
    const pendiente = calcularPendiente(periodo, acumulados.resultadoDealAcumulado);
    const gananciaDisponible = input.gananciaDisponible ?? Math.max(0, pendiente);

    const calc = calcularSplitExtraordinario({
      memoriaActual: Number(periodo.memoria_actual),
      gananciaDisponible,
      memoriaAplicada: input.memoriaAplicada,
      splitCfg: cfgV1(contrato),
    });

    const gananciaTeambackTotal = calcularGananciaTeamback(0, calc.splitTeamback);
    const pagoTeorico = calc.splitJugador;
    const pagoReal = input.pagoReal ?? pagoTeorico;
    const creditoPendiente = calcularCreditoPendiente(pagoTeorico, pagoReal);

    const liqId = newId("bliq");
    await client.query(
      `INSERT INTO bancado_contrato_liquidaciones
         (id, contrato_id, periodo_id, tipo, resultado_acumulado, memoria_anterior, memoria_aplicada, memoria_final,
          base_liberada_split, split_jugador_pct, split_jugador, split_teamback_pct, split_teamback,
          ganancia_teamback_total, pago_teorico_jugador, pago_real_jugador, credito_pendiente_jugador,
          autorizado_por, motivo, observaciones, created_by)
       VALUES ($1,$2,$3,'EXTRAORDINARIO',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        liqId,
        periodo.contrato_id,
        input.periodoId,
        gananciaDisponible,
        periodo.memoria_actual,
        calc.memoriaAplicada,
        calc.memoriaFinal,
        calc.resultadoLiberado,
        contrato.v1_split_jugador_pct,
        calc.splitJugador,
        contrato.v1_split_teamback_pct,
        calc.splitTeamback,
        gananciaTeambackTotal,
        pagoTeorico,
        pagoReal,
        creditoPendiente,
        input.autorizadoPor,
        input.motivo,
        input.observaciones ?? null,
        createdBy ?? null,
      ]
    );

    await client.query(
      `UPDATE bancado_contrato_periodos SET memoria_actual = $1, resultado_ya_distribuido = resultado_ya_distribuido + $2 WHERE id = $3`,
      [calc.memoriaFinal, calc.resultadoLiberado, input.periodoId]
    );

    if (creditoPendiente !== 0) {
      await client.query(
        `INSERT INTO bancado_contrato_ajustes (id, contrato_id, periodo_id, tipo, importe, signo, liquidacion_origen_id, usuario, motivo)
         VALUES ($1,$2,$3,'PAGO_PENDIENTE',$4,$5,$6,$7,$8)`,
        [
          newId("baj"),
          periodo.contrato_id,
          input.periodoId,
          Math.abs(creditoPendiente),
          creditoPendiente > 0 ? "POSITIVO" : "NEGATIVO",
          liqId,
          input.autorizadoPor,
          "Diferencia entre pago teórico y pago real de un split extraordinario.",
        ]
      );
    }

    await client.query("COMMIT");
    return { liquidacionId: liqId, ...calc, gananciaDisponible };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Cierre mensual (secciones 12-16, 19-22, 27)
// ---------------------------------------------------------------------------------------------
export interface CierreMensualInput {
  periodoId: string;
  modoMemoria?: ModoMemoria; // override puntual del modo del período, si hiciera falta
  memoriaAplicadaManual?: number; // obligatorio si el modo (del período o el override) es PARCIAL_MANUAL
  pagoReal?: number; // si no se manda, se asume que se pagó el teórico completo
  autorizadoPor: string;
}

export async function ejecutarCierreMensual(input: CierreMensualInput, createdBy?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodoRes = await client.query(`SELECT * FROM bancado_contrato_periodos WHERE id = $1 FOR UPDATE`, [input.periodoId]);
    const periodo = periodoRes.rows[0];
    if (!periodo) throw new Error("Período no encontrado.");
    if (periodo.estado !== "ABIERTO") throw new Error("El período ya está CERRADO.");
    const contrato = await getContrato(periodo.contrato_id);

    const acumulados = await acumuladosPeriodo(input.periodoId, client);
    const pendiente = calcularPendiente(periodo, acumulados.resultadoDealAcumulado);
    const modoMemoria = input.modoMemoria ?? periodo.modo_memoria;

    const calc = calcularRecuperacionYSplit({
      pendiente,
      memoriaActual: Number(periodo.memoria_actual),
      modoMemoria,
      memoriaAplicadaManual: input.memoriaAplicadaManual,
      splitCfg: cfgV1(contrato),
    });

    // Sección 22: la ganancia TeamBack del mes = TODO el rake directo acumulado de los
    // parciales (nunca se reparte, se cuenta una sola vez acá) + el split TeamBack de este
    // cierre definitivo. Los splits extraordinarios del mes YA quedaron contabilizados en sus
    // propias filas de liquidación -- no se vuelven a sumar acá (sección 18: "nunca duplicar").
    const gananciaTeambackTotal = calcularGananciaTeamback(acumulados.rakeTeambackAcumulado, calc.splitTeamback);
    const pagoTeorico = calc.splitJugador;
    const pagoReal = input.pagoReal ?? pagoTeorico;
    const creditoPendiente = calcularCreditoPendiente(pagoTeorico, pagoReal);

    const liqId = newId("bliq");
    await client.query(
      `INSERT INTO bancado_contrato_liquidaciones
         (id, contrato_id, periodo_id, tipo, desde, hasta, resultado_mesas, rake_bruto,
          resultado_acumulado, memoria_anterior, modo_memoria, recuperacion_maxima, memoria_aplicada, memoria_final,
          base_liberada_split, split_jugador_pct, split_jugador, split_teamback_pct, split_teamback,
          rake_teamback_directo, ganancia_teamback_total, pago_teorico_jugador, pago_real_jugador, credito_pendiente_jugador,
          autorizado_por, created_by)
       VALUES ($1,$2,$3,'MENSUAL',
               (SELECT MIN(desde) FROM bancado_contrato_parciales WHERE periodo_id = $3),
               (SELECT MAX(hasta) FROM bancado_contrato_parciales WHERE periodo_id = $3),
               $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        liqId,
        periodo.contrato_id,
        input.periodoId,
        acumulados.resultadoMesasAcumulado,
        acumulados.rakeBrutoAcumulado,
        pendiente,
        periodo.memoria_actual,
        modoMemoria,
        calc.recuperacionMaxima,
        calc.memoriaAplicada,
        calc.memoriaFinal,
        calc.resultadoParaSplit,
        contrato.v1_split_jugador_pct,
        calc.splitJugador,
        contrato.v1_split_teamback_pct,
        calc.splitTeamback,
        acumulados.rakeTeambackAcumulado,
        gananciaTeambackTotal,
        pagoTeorico,
        pagoReal,
        creditoPendiente,
        input.autorizadoPor,
        createdBy ?? null,
      ]
    );

    await client.query(
      `UPDATE bancado_contrato_periodos
         SET estado = 'CERRADO', memoria_actual = $1, memoria_final = $1, cerrado_en = now(), cerrado_por = $2
       WHERE id = $3`,
      [calc.memoriaFinal, input.autorizadoPor, input.periodoId]
    );

    if (creditoPendiente !== 0) {
      await client.query(
        `INSERT INTO bancado_contrato_ajustes (id, contrato_id, periodo_id, tipo, importe, signo, liquidacion_origen_id, usuario, motivo)
         VALUES ($1,$2,$3,'PAGO_PENDIENTE',$4,$5,$6,$7,$8)`,
        [
          newId("baj"),
          periodo.contrato_id,
          input.periodoId,
          Math.abs(creditoPendiente),
          creditoPendiente > 0 ? "POSITIVO" : "NEGATIVO",
          liqId,
          input.autorizadoPor,
          "Diferencia entre pago teórico y pago real del cierre mensual.",
        ]
      );
    }

    await client.query("COMMIT");
    return { liquidacionId: liqId, ...calc, gananciaTeambackTotal, pagoTeorico, pagoReal, creditoPendiente };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Regla RMF -- motor de CAPITAL + MAKEUP de "Jugadores bancados" clásico (engine/bancados.ts),
// reutilizado tal cual, sin duplicar la fórmula. CORRECCIÓN 02/10/2026: esta es la regla que
// Leo pedía como "RMF" -- no la de reparto 50/50 + memoria de agentes. No hay período ni mes:
// cada semana se liquida sola. Nunca se guarda un capital/makeup "actual" mutable -- se deriva
// siempre del último cierre APLICADO de este contrato (mismo patrón que getEstadoBancado en
// repo/bancados.ts), así un cierre nunca puede quedar desincronizado de su propio historial.
// ---------------------------------------------------------------------------------------------
function cfgRmf(contrato: any): BancadoConfigRmf {
  return {
    pctJugador: Number(contrato.rmf_pct_jugador),
    pctBanca: Number(contrato.rmf_pct_banca),
    rakebackPct: Number(contrato.rmf_rakeback_pct),
    rakebackBancaPct: Number(contrato.rmf_rakeback_banca_pct ?? 0),
    unionSharePct: Number(contrato.rmf_union_share_pct ?? 0),
    capitalInicial: Number(contrato.rmf_capital_inicial ?? 0),
    makeupInicial: Number(contrato.rmf_makeup_inicial ?? 0),
  };
}

async function getEstadoRmf(contratoId: string, cfg: BancadoConfigRmf, client?: PoolClient): Promise<BancadoEstadoRmf> {
  const q = client ? client.query.bind(client) : pool.query.bind(pool);
  const r = await q(
    `SELECT capital_despues, makeup_nuevo FROM bancado_contrato_rmf_cierres
     WHERE contrato_id = $1 AND status = 'APLICADO' ORDER BY hasta DESC, created_at DESC LIMIT 1`,
    [contratoId]
  );
  if (r.rows.length === 0) return { capitalActual: cfg.capitalInicial, makeupActual: cfg.makeupInicial };
  return { capitalActual: Number(r.rows[0].capital_despues), makeupActual: Number(r.rows[0].makeup_nuevo) };
}

export interface RegistrarCierreRmfInput {
  contratoId: string;
  desde: string;
  hasta: string;
  resultadoMesas: number;
  rakeBruto: number;
  ticketPromocional?: number;
  ticketPromocionalNota?: string | null;
  observaciones?: string | null;
  pagoReal?: number;
}

export async function registrarCierreRmf(input: RegistrarCierreRmfInput, createdBy?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR UPDATE sobre el contrato: dos cierres de la misma semana no se pueden pisar el
    // capital/makeup, igual criterio que bancado_debts en el otro motor.
    const contratoRes = await client.query(`SELECT * FROM bancado_contratos WHERE id = $1 FOR UPDATE`, [input.contratoId]);
    const contrato = contratoRes.rows[0];
    if (!contrato) throw new Error("Contrato no encontrado.");
    if (contrato.regla_key !== "RMF") throw new Error("Este contrato no usa la regla RMF.");
    if (input.hasta < input.desde) throw new Error("La fecha \"hasta\" no puede ser anterior a \"desde\".");

    // Pedido Leo 05/10/2026: evitar cerrar la misma semana dos veces por error (duplicaría el
    // rakeback, el pago al jugador y el movimiento de capital/makeup).
    const solapado = await client.query(
      `SELECT id, desde, hasta FROM bancado_contrato_rmf_cierres
       WHERE contrato_id = $1 AND status = 'APLICADO' AND desde <= $3 AND hasta >= $2 LIMIT 1`,
      [input.contratoId, input.desde, input.hasta]
    );
    if (solapado.rows.length > 0) {
      const ex = solapado.rows[0];
      throw new Error(`Ya existe un cierre RMF que se superpone con esas fechas (${ex.desde} a ${ex.hasta}) -- revertilo primero si hay que corregirlo.`);
    }

    const cfg = cfgRmf(contrato);
    const estado = await getEstadoRmf(input.contratoId, cfg, client);
    const calc = calcularCierreBancadoRmf(cfg, estado, {
      resultadoMesas: input.resultadoMesas,
      rakeTotal: input.rakeBruto,
      ticketPromocional: input.ticketPromocional,
    });

    const pagoTeorico = calc.pagoJugadorTotal;
    const pagoReal = input.pagoReal ?? pagoTeorico;
    const creditoPendiente = calcularCreditoPendiente(pagoTeorico, pagoReal);

    const cierreId = newId("brmf");
    await client.query(
      `INSERT INTO bancado_contrato_rmf_cierres
         (id, contrato_id, desde, hasta, resultado_mesas, rake_total, ticket_promocional, ticket_promocional_nota,
          rakeback_total, makeup_anterior, perdida_agrega_makeup, rakeback_a_makeup, rakeback_excedente_jugador,
          ganancia_mesas_jugador_bruta, ganancia_mesas_a_makeup, makeup_nuevo, pago_jugador_mesas, pago_jugador_total,
          ganancia_banca_mesas, rakeback_banca_total, union_share_total, capital_anterior, capital_despues,
          pago_real_jugador, credito_pendiente_jugador, observaciones, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        cierreId,
        input.contratoId,
        input.desde,
        input.hasta,
        calc.resultadoMesas,
        calc.rakeTotal,
        calc.ticketPromocional,
        input.ticketPromocionalNota ?? null,
        calc.rakebackTotal,
        calc.makeupAnterior,
        calc.perdidaAgregaMakeup,
        calc.rakebackAMakeup,
        calc.rakebackExcedenteJugador,
        calc.gananciaMesasJugadorBruta,
        calc.gananciaMesasAMakeup,
        calc.makeupNuevo,
        calc.pagoJugadorMesas,
        calc.pagoJugadorTotal,
        calc.gananciaBancaMesas,
        calc.rakebackBancaTotal,
        calc.unionShareTotal,
        calc.capitalAnterior,
        calc.capitalDespues,
        pagoReal,
        creditoPendiente,
        input.observaciones ?? null,
        createdBy ?? null,
      ]
    );

    if (creditoPendiente !== 0) {
      await client.query(
        `INSERT INTO bancado_contrato_ajustes (id, contrato_id, tipo, importe, signo, usuario, motivo)
         VALUES ($1,$2,'PAGO_PENDIENTE',$3,$4,$5,$6)`,
        [
          newId("baj"),
          input.contratoId,
          Math.abs(creditoPendiente),
          creditoPendiente > 0 ? "POSITIVO" : "NEGATIVO",
          createdBy ?? "sistema",
          "Diferencia entre pago teórico y pago real del cierre semanal RMF.",
        ]
      );
    }

    await client.query("COMMIT");
    return { cierreId, ...calc, pagoReal, creditoPendiente };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listHistorialRmf(contratoId: string) {
  const r = await pool.query(`SELECT * FROM bancado_contrato_rmf_cierres WHERE contrato_id = $1 ORDER BY hasta DESC, created_at DESC`, [contratoId]);
  return r.rows;
}

// Revertir (nunca se borra, mismo patrón que weekly_closings/bancado_historial): marca el
// cierre como REVERTIDO -- el próximo cierre que se cargue va a derivar el capital/makeup del
// último APLICADO anterior a este, como si nunca hubiera pasado.
export async function revertirCierreRmf(id: string, motivo: string | undefined, revertidoPor?: string | null) {
  const r = await pool.query(
    `UPDATE bancado_contrato_rmf_cierres SET status = 'REVERTIDO', motivo_reversion = $1 WHERE id = $2 AND status = 'APLICADO' RETURNING *`,
    [motivo ?? null, id]
  );
  if (r.rows.length === 0) throw new Error("Cierre no encontrado o ya estaba revertido.");
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------
// Historiales (sección 25/26) -- nunca se sobrescriben, se consultan nomás
// ---------------------------------------------------------------------------------------------
export async function listLiquidaciones(contratoId: string, periodoId?: string) {
  const r = periodoId
    ? await pool.query(`SELECT * FROM bancado_contrato_liquidaciones WHERE contrato_id = $1 AND periodo_id = $2 ORDER BY created_at DESC`, [contratoId, periodoId])
    : await pool.query(`SELECT * FROM bancado_contrato_liquidaciones WHERE contrato_id = $1 ORDER BY created_at DESC`, [contratoId]);
  return r.rows;
}

// ---------------------------------------------------------------------------------------------
// Ajustes (sección 23)
// ---------------------------------------------------------------------------------------------
export type AjusteTipo =
  | "CREDITO_JUGADOR"
  | "DEBITO_JUGADOR"
  | "AJUSTE_MEMORIA"
  | "CORRECCION_CIERRE"
  | "PAGO_PENDIENTE"
  | "COMPENSACION"
  | "ADMINISTRATIVO";

export interface CrearAjusteInput {
  contratoId: string;
  periodoId?: string | null;
  tipo: AjusteTipo;
  importe: number;
  signo: "POSITIVO" | "NEGATIVO";
  fecha?: string;
  usuario: string;
  motivo: string;
  observaciones?: string | null;
}

export async function crearAjuste(input: CrearAjusteInput) {
  const id = newId("baj");
  const r = await pool.query(
    `INSERT INTO bancado_contrato_ajustes (id, contrato_id, periodo_id, tipo, importe, signo, fecha, usuario, motivo, observaciones)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, CURRENT_DATE),$8,$9,$10) RETURNING *`,
    [id, input.contratoId, input.periodoId ?? null, input.tipo, input.importe, input.signo, input.fecha ?? null, input.usuario, input.motivo, input.observaciones ?? null]
  );
  return r.rows[0];
}

export async function resolverAjuste(id: string, resueltoPor: string, nuevoEstado: "APLICADO" | "REVERTIDO") {
  const r = await pool.query(
    `UPDATE bancado_contrato_ajustes SET estado = $1, resuelto_en = now(), resuelto_por = $2 WHERE id = $3 AND estado = 'PENDIENTE' RETURNING *`,
    [nuevoEstado, resueltoPor, id]
  );
  if (r.rows.length === 0) throw new Error("Ajuste no encontrado o ya estaba resuelto.");
  return r.rows[0];
}

export async function listAjustes(contratoId: string) {
  const r = await pool.query(`SELECT * FROM bancado_contrato_ajustes WHERE contrato_id = $1 ORDER BY created_at DESC`, [contratoId]);
  return r.rows;
}

// ---------------------------------------------------------------------------------------------
// Fijo (sección 29) -- COSTO_FIJO, completamente aparte del deal
// ---------------------------------------------------------------------------------------------
export interface RegistrarCostoFijoInput {
  contratoId: string;
  anio: number;
  mes: number;
  monto: number;
  moneda?: string;
  observaciones?: string | null;
}

export async function registrarCostoFijo(input: RegistrarCostoFijoInput, createdBy?: string | null) {
  const id = newId("bfix");
  const r = await pool.query(
    `INSERT INTO bancado_contrato_costos_fijos (id, contrato_id, anio, mes, monto, moneda, observaciones, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (contrato_id, anio, mes) DO UPDATE SET monto = EXCLUDED.monto, moneda = EXCLUDED.moneda, observaciones = EXCLUDED.observaciones
     RETURNING *`,
    [id, input.contratoId, input.anio, input.mes, input.monto, input.moneda ?? "ARS", input.observaciones ?? null, createdBy ?? null]
  );
  return r.rows[0];
}

export async function listCostosFijos(contratoId: string) {
  const r = await pool.query(`SELECT * FROM bancado_contrato_costos_fijos WHERE contrato_id = $1 ORDER BY anio DESC, mes DESC`, [contratoId]);
  return r.rows;
}
