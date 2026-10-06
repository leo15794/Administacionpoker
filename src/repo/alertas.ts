// Campana de notificaciones del sistema (06/10/2026, pedido de Leo: "una campana de
// notificaciones del sistema? que podria alertar analiza y decime"). NO es una tabla nueva ni
// un proceso en segundo plano -- son unas consultas de SOLO LECTURA sobre lo que ya está en el
// ledger, calculadas en caliente cada vez que se pide /alertas (misma filosofía que el resto
// del sistema: nunca se guarda un número fijo que se pueda desincronizar de la realidad).
//
// Alcance v1 (lo que pidió Leo, en orden de aparición):
//   1) Saldos pendientes grandes o viejos -- ajustes/cobros/pagos marcados con "resto" (la
//      función marcarSaldoPendiente de agentesResumen.ts) que siguen sin resolverse.
//   2) Movimientos nuevos/inusuales -- cargados hace poco, con un importe grande o con la
//      fecha real (occurred_at) bastante anterior a cuando se cargaron (registered_at) --
//      mismo patrón que la CARGA de "El Látigo Loco" que Leo tuvo que investigar a mano.
//   3) Inconsistencias -- agentes activos (Win/Lose o Prepago) sin ningún deal vigente
//      asignado, y reversiones recientes de movimientos viejos (candidatas a dejar residuo en
//      la semana equivocada de "Resumen por agente", ver revertirMovimiento en ledger.ts: la
//      reversa siempre queda fechada "ahora", nunca con la fecha del movimiento original).
//
// Los umbrales de abajo son un punto de partida razonable, no un número mágico — se pueden
// ajustar sin tocar nada más si en la práctica resultan muy sensibles o muy poco sensibles.
import { pool } from "../db/pool.js";

const UMBRAL_SALDO_PENDIENTE_ALTA = 300; // USD
const DIAS_SALDO_PENDIENTE_VIEJO = 14;
const UMBRAL_MOVIMIENTO_GRANDE = 1000; // USD
const DIAS_VENTANA_MOVIMIENTOS_RECIENTES = 3; // "recién cargado" = registrado en estos últimos N días
const DIAS_BACKDATE_SOSPECHOSO = 5; // occurred_at vs registered_at
const DIAS_VENTANA_REVERSIONES_RECIENTES = 3;
const DIAS_REVERSION_TARDIA = 4; // más de esto entre el movimiento original y su reversión

export type SeveridadAlerta = "alta" | "media";
export type TipoAlerta = "SALDO_PENDIENTE" | "MOVIMIENTO_INUSUAL" | "SIN_DEAL" | "REVERSION_TARDIA";

export interface Alerta {
  id: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  mensaje: string;
  agentId: string | null;
  agentName: string | null;
  clubId: string | null;
  clubName: string | null;
  monto: number | null;
  fecha: string; // ISO -- fecha "de referencia" de la alerta (no siempre occurred_at)
}

function money(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function diasDesde(fecha: Date): number {
  return Math.floor((Date.now() - fecha.getTime()) / 86400000);
}

async function alertasSaldoPendiente(): Promise<Alerta[]> {
  const res = await pool.query(
    `SELECT m.id, m.agent_id, a.name as agent_name, m.club_id, c.name as club_name,
            m.saldo_pendiente_restante, m.occurred_at, m.type
     FROM ledger_movements m
     JOIN agents a ON a.id = m.agent_id
     JOIN clubs c ON c.id = m.club_id
     WHERE m.saldo_pendiente_restante IS NOT NULL
       AND m.status <> 'REVERTIDO'
       AND (
         ABS(m.saldo_pendiente_restante) >= $1
         OR m.occurred_at < now() - interval '${DIAS_SALDO_PENDIENTE_VIEJO} days'
       )
     ORDER BY ABS(m.saldo_pendiente_restante) DESC
     LIMIT 50`,
    [UMBRAL_SALDO_PENDIENTE_ALTA]
  );
  return res.rows.map((r: any) => {
    const restante = Number(r.saldo_pendiente_restante);
    const dias = diasDesde(new Date(r.occurred_at));
    const esAlta = Math.abs(restante) >= UMBRAL_SALDO_PENDIENTE_ALTA;
    return {
      id: `saldo_pendiente_${r.id}`,
      tipo: "SALDO_PENDIENTE",
      severidad: esAlta ? "alta" : "media",
      mensaje: `${r.agent_name} (${r.club_name}): queda US$ ${money(Math.abs(restante))} pendiente de un ${r.type.toLowerCase()}, desde hace ${dias} día${dias === 1 ? "" : "s"}.`,
      agentId: r.agent_id,
      agentName: r.agent_name,
      clubId: r.club_id,
      clubName: r.club_name,
      monto: restante,
      fecha: r.occurred_at,
    } as Alerta;
  });
}

async function alertasMovimientosInusuales(): Promise<Alerta[]> {
  const res = await pool.query(
    `SELECT m.id, m.agent_id, a.name as agent_name, m.club_id, c.name as club_name,
            m.type, m.amount, m.occurred_at, m.registered_at
     FROM ledger_movements m
     JOIN agents a ON a.id = m.agent_id
     JOIN clubs c ON c.id = m.club_id
     WHERE m.status <> 'REVERTIDO'
       AND m.type NOT IN ('CIERRE_SEMANAL')
       AND m.registered_at > now() - interval '${DIAS_VENTANA_MOVIMIENTOS_RECIENTES} days'
       AND (
         ABS(m.amount) >= $1
         OR m.occurred_at < m.registered_at - interval '${DIAS_BACKDATE_SOSPECHOSO} days'
       )
     ORDER BY m.registered_at DESC
     LIMIT 50`,
    [UMBRAL_MOVIMIENTO_GRANDE]
  );
  return res.rows.map((r: any) => {
    const monto = Number(r.amount);
    const backdateDias = Math.floor(
      (new Date(r.registered_at).getTime() - new Date(r.occurred_at).getTime()) / 86400000
    );
    const esBackdate = backdateDias >= DIAS_BACKDATE_SOSPECHOSO;
    const esGrande = Math.abs(monto) >= UMBRAL_MOVIMIENTO_GRANDE;
    let detalle = "";
    if (esGrande && esBackdate) {
      detalle = `importe grande (US$ ${money(Math.abs(monto))}) y cargado con fecha ${backdateDias} días anterior a cuando se registró`;
    } else if (esGrande) {
      detalle = `importe grande: US$ ${money(Math.abs(monto))}`;
    } else {
      detalle = `cargado con fecha ${backdateDias} días anterior a cuando se registró -- revisar que no sea un movimiento de prueba o un error de fecha`;
    }
    return {
      id: `movimiento_${r.id}`,
      tipo: "MOVIMIENTO_INUSUAL",
      severidad: esGrande ? "alta" : "media",
      mensaje: `${r.agent_name} (${r.club_name}): ${r.type} de ${detalle}.`,
      agentId: r.agent_id,
      agentName: r.agent_name,
      clubId: r.club_id,
      clubName: r.club_name,
      monto,
      fecha: r.registered_at,
    } as Alerta;
  });
}

async function alertasSinDeal(): Promise<Alerta[]> {
  const res = await pool.query(
    `SELECT a.id, a.name
     FROM agents a
     WHERE a.active <> false
       AND a.account_type IN ('WIN_LOSE','PREPAGO')
       AND NOT EXISTS (
         SELECT 1 FROM agent_club_deals d WHERE d.agent_id = a.id AND d.valid_to IS NULL
       )
     ORDER BY a.name
     LIMIT 50`
  );
  return res.rows.map((r: any) => ({
    id: `sin_deal_${r.id}`,
    tipo: "SIN_DEAL",
    severidad: "media",
    mensaje: `${r.name} está activo (Win/Lose o Prepago) pero no tiene ningún deal asignado en ningún club -- hoy no tiene % de rakeback/rebate propio.`,
    agentId: r.id,
    agentName: r.name,
    clubId: null,
    clubName: null,
    monto: null,
    fecha: new Date().toISOString(),
  }));
}

async function alertasReversionTardia(): Promise<Alerta[]> {
  // La reversa de un movimiento SIEMPRE se guarda como type='AJUSTE', con idempotency_key
  // 'revert_<id del original>' y occurred_at=ahora (ver revertirMovimiento en ledger.ts) --
  // nunca con la fecha del movimiento que cancela. Si el original era de hace varios días, su
  // efecto quedó contado en el bucket semanal de ESA fecha, pero la reversa que lo cancela cae
  // en el bucket de HOY -- "Resumen por agente" puede mostrar residuo en las dos semanas hasta
  // que alguien lo note a mano (caso real: El Látigo Loco, 05/10/2026).
  const res = await pool.query(
    `SELECT m.id, m.agent_id, a.name as agent_name, m.club_id, c.name as club_name,
            m.occurred_at as revertido_en, orig.occurred_at as original_en, orig.type as original_type
     FROM ledger_movements m
     JOIN ledger_movements orig ON orig.id = substring(m.idempotency_key, 8)
     JOIN agents a ON a.id = m.agent_id
     JOIN clubs c ON c.id = m.club_id
     WHERE m.idempotency_key LIKE 'revert_%'
       AND m.status <> 'REVERTIDO'
       AND m.registered_at > now() - interval '${DIAS_VENTANA_REVERSIONES_RECIENTES} days'
       AND orig.occurred_at < m.occurred_at - interval '${DIAS_REVERSION_TARDIA} days'
     ORDER BY m.registered_at DESC
     LIMIT 50`
  );
  return res.rows.map((r: any) => {
    const dias = Math.floor(
      (new Date(r.revertido_en).getTime() - new Date(r.original_en).getTime()) / 86400000
    );
    return {
      id: `reversion_tardia_${r.id}`,
      tipo: "REVERSION_TARDIA",
      severidad: "media",
      mensaje: `${r.agent_name} (${r.club_name}): se revirtió un ${r.original_type.toLowerCase()} de hace ${dias} días -- revisar "Resumen por agente" de esa semana y de esta, puede haber quedado un residuo sin cancelar.`,
      agentId: r.agent_id,
      agentName: r.agent_name,
      clubId: r.club_id,
      clubName: r.club_name,
      monto: null,
      fecha: r.revertido_en,
    } as Alerta;
  });
}

export async function listarAlertas(): Promise<Alerta[]> {
  const [saldos, movimientos, sinDeal, reversiones] = await Promise.all([
    alertasSaldoPendiente(),
    alertasMovimientosInusuales(),
    alertasSinDeal(),
    alertasReversionTardia(),
  ]);
  const todas = [...saldos, ...movimientos, ...sinDeal, ...reversiones];
  const orden: Record<SeveridadAlerta, number> = { alta: 0, media: 1 };
  todas.sort((a, b) => orden[a.severidad] - orden[b.severidad] || new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  return todas;
}
