// Resumen financiero (18/09/2026, pedido explícito): "un resumen de todas las ganancias, cada
// ingreso y cada egreso que se contabiliza, filtrable por día/semana/mes, para ver el desglose
// de cómo se va contabilizando todo". Junta en una sola lista de EVENTOS cada cosa que mueve o
// genera plata en el sistema:
//
//  - WALLET: ingresos/egresos reales de Wallet/Caja — tanto los ajustes manuales
//    (treasury_adjustments) como los automáticos que genera un movimiento de agente
//    (treasury_entries), mismo criterio que ya usa la pantalla de Tesorería.
//  - CIERRE_SEMANAL: la "Ganancia Neta" de cada club+semana con cierres cargados — EXACTAMENTE
//    la misma cuenta que ya usa el Resumen ejecutivo y el Resumen por club (repo/clubResumen.ts,
//    getResumenClubSemanal: rake*ratio del club - rakeback + ganancia de rodeo del club +
//    ingreso por ventas + tasa semanal fija), para que nunca muestre un número distinto al de
//    esas pantallas. Es plata que el sistema ya reconoce como ganancia aunque no se haya
//    retirado a Wallet todavía.
//  - BANCADO: la ganancia de cada cierre semanal de banca (ganancia_banca_mesas, que ya incluye
//    el Rakeback Banca — ver engine/bancados.ts).
//  - COMISION_REFERIDO: cada acreditación (COMISION), corrección (CORRECCION) o pago (PAGO) de
//    comisión por referido a un supervisor.
//
// Un mismo peso puede aparecer en más de una categoría en distintos momentos (ej. la ganancia
// de un cierre semanal es un evento CIERRE_SEMANAL cuando se cierra, y si después alguien la
// retira de Wallet, ESO es un evento WALLET aparte) — es intencional: cada categoría responde
// una pregunta distinta ("¿cuánto generamos?" vs "¿cuánta plata entró o salió de verdad?"), por
// eso el front nunca sonda todo junto en un solo total, siempre por categoría.
import { pool } from "../db/pool.js";
import { getResumenClubSemanal } from "./clubResumen.js";

export interface ResumenFinancieroEvento {
  id: string;
  fecha: string; // YYYY-MM-DD
  categoria: "WALLET" | "CIERRE_SEMANAL" | "BANCADO" | "COMISION_REFERIDO";
  subcategoria: string;
  tipo: "INGRESO" | "EGRESO" | "GANANCIA" | "CORRECCION";
  monto: number; // siempre con signo: positivo = a favor, negativo = en contra
  detalle: string;
  // Deep-link opcional a la pantalla donde vive el detalle real de este evento (ej. un cierre
  // semanal → Cierres, con la semana/club marcados) — ver Cierres.tsx (?week=&club=).
  enlace?: string;
}

function toFecha(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

// Lunes de la semana ISO a la que pertenece la fecha (mismo criterio que week_start en
// weekly_closings/bancado_historial, que siempre son lunes).
function lunesDe(fechaIso: string): string {
  const d = new Date(fechaIso + "T00:00:00Z");
  const dow = d.getUTCDay() || 7; // domingo = 7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function getResumenFinanciero(desde: string, hasta: string) {
  // "hasta" es inclusivo desde el punto de vista del usuario (eligió un día y quiere ver ESE
  // día completo) — se arma el límite exclusivo sumando un día para el filtro real.
  const hastaExclusivo = new Date(hasta + "T00:00:00Z");
  hastaExclusivo.setUTCDate(hastaExclusivo.getUTCDate() + 1);
  const hastaParam = hastaExclusivo.toISOString().slice(0, 10);

  const [ajustes, automaticos, clubesSemana, bancados, comisiones] = await Promise.all([
    pool.query(
      `SELECT id, occurred_at, ledger, direction, amount, reason
       FROM treasury_adjustments
       WHERE status <> 'REVERTIDO' AND occurred_at >= $1 AND occurred_at < $2
       ORDER BY occurred_at`,
      [desde, hastaParam]
    ),
    pool.query(
      `SELECT t.id, t.occurred_at, t.ledger, t.direction, t.amount, m.type, a.name as agent_name
       FROM treasury_entries t
       JOIN ledger_movements m ON m.id = t.movement_id
       JOIN agents a ON a.id = m.agent_id
       WHERE m.status <> 'REVERTIDO'
         AND NOT (t.ledger = 'WALLET_MANOS' AND m.created_by = 'import:historial-automatizacion')
         AND t.occurred_at >= $1 AND t.occurred_at < $2
       ORDER BY t.occurred_at`,
      [desde, hastaParam]
    ),
    // Distinct club+semana con cierres cargados en el rango — la Ganancia Neta se calcula UNA
    // vez por club+semana (getResumenClubSemanal ya suma todos los agentes de ese club esa
    // semana más rodeo/ventas/tasa fija), nunca por cierre individual de agente.
    pool.query(
      `SELECT DISTINCT club_id, week_start FROM weekly_closings
       WHERE status IN ('APLICADO','CORREGIDO') AND week_start >= $1 AND week_start < $2
       ORDER BY week_start`,
      [desde, hastaParam]
    ),
    pool.query(
      `SELECT h.id, h.week_start, h.ganancia_banca_mesas, h.rakeback_banca_total,
              p.display_name as player_name, c.name as club_name
       FROM bancado_historial h
       JOIN players p ON p.id = h.player_id
       JOIN clubs c ON c.id = h.club_id
       WHERE h.status <> 'REVERTIDO' AND h.tipo = 'CIERRE_SEMANAL'
         AND h.week_start >= $1 AND h.week_start < $2
       ORDER BY h.week_start`,
      [desde, hastaParam]
    ),
    pool.query(
      `SELECT rm.id, rm.occurred_at, rm.type, rm.amount, a.name as agente_referido_name, u.email
       FROM supervisor_referido_movements rm
       JOIN supervisor_referidos r ON r.id = rm.referido_id
       JOIN agents a ON a.id = r.agente_referido_id
       JOIN agent_users u ON u.id = r.supervisor_user_id
       WHERE rm.occurred_at >= $1 AND rm.occurred_at < $2
       ORDER BY rm.occurred_at`,
      [desde, hastaParam]
    ),
  ]);

  // getResumenClubSemanal no es una simple query — hay que llamarla una vez por cada club+semana
  // distinto encontrado arriba (mismo camino que ya recorre el Resumen ejecutivo).
  const resumenesClubSemana = await Promise.all(
    clubesSemana.rows.map((r) => getResumenClubSemanal(r.club_id, toFecha(r.week_start)))
  );

  const eventos: ResumenFinancieroEvento[] = [];

  for (const row of ajustes.rows) {
    eventos.push({
      id: row.id,
      fecha: toFecha(row.occurred_at),
      categoria: "WALLET",
      subcategoria: `Ajuste manual — ${row.ledger === "WALLET_MANOS" ? "Wallet USDT" : "Caja efectivo"}`,
      tipo: row.direction,
      monto: row.direction === "INGRESO" ? Number(row.amount) : -Number(row.amount),
      detalle: row.reason,
    });
  }

  for (const row of automaticos.rows) {
    eventos.push({
      id: row.id,
      fecha: toFecha(row.occurred_at),
      categoria: "WALLET",
      subcategoria: `Movimiento de agente — ${row.ledger === "WALLET_MANOS" ? "Wallet USDT" : "Caja efectivo"}`,
      tipo: row.direction,
      monto: row.direction === "INGRESO" ? Number(row.amount) : -Number(row.amount),
      detalle: `${row.agent_name} (${row.type})`,
    });
  }

  for (const r of resumenesClubSemana) {
    if (!r) continue;
    eventos.push({
      id: `${r.clubId}_${r.weekStart}`,
      fecha: r.weekStart,
      categoria: "CIERRE_SEMANAL",
      subcategoria: `Cierre semanal — ${r.clubName}`,
      tipo: "GANANCIA",
      monto: round2(r.gananciaNeta),
      detalle: `${r.agentesConCierre} agente(s) — rake ${round2(r.rakeTotal)}, rakeback ${round2(r.comisionesAgentes)}${r.gananciaRodeoClub ? `, rodeo club ${round2(r.gananciaRodeoClub)}` : ""}${r.ingresoPorVentas ? `, ventas ${round2(r.ingresoPorVentas)}` : ""}`,
      enlace: `/dashboard/cierres?week=${r.weekStart}&club=${r.clubId}`,
    });
  }

  for (const row of bancados.rows) {
    eventos.push({
      id: row.id,
      fecha: toFecha(row.week_start),
      categoria: "BANCADO",
      subcategoria: `Cierre de banca — ${row.club_name}`,
      tipo: "GANANCIA",
      monto: Number(row.ganancia_banca_mesas),
      detalle: `${row.player_name} (incluye Rakeback Banca ${row.rakeback_banca_total})`,
    });
  }

  for (const row of comisiones.rows) {
    eventos.push({
      id: row.id,
      fecha: toFecha(row.occurred_at),
      categoria: "COMISION_REFERIDO",
      subcategoria: `Comisión por referido — ${row.email}`,
      tipo: row.type === "COMISION" ? "GANANCIA" : row.type === "PAGO" ? "EGRESO" : "CORRECCION",
      monto: Number(row.amount),
      detalle: row.agente_referido_name,
    });
  }

  eventos.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  // Totales del rango completo, por categoría — para las tarjetas de arriba.
  function sum(cat: ResumenFinancieroEvento["categoria"], filtro?: (e: ResumenFinancieroEvento) => boolean) {
    return round2(
      eventos.filter((e) => e.categoria === cat && (!filtro || filtro(e))).reduce((acc, e) => acc + e.monto, 0)
    );
  }
  const totales = {
    walletIngresos: round2(
      eventos.filter((e) => e.categoria === "WALLET" && e.monto > 0).reduce((acc, e) => acc + e.monto, 0)
    ),
    walletEgresos: round2(
      eventos.filter((e) => e.categoria === "WALLET" && e.monto < 0).reduce((acc, e) => acc + Math.abs(e.monto), 0)
    ),
    walletNeto: sum("WALLET"),
    gananciaCierres: sum("CIERRE_SEMANAL"),
    gananciaBancados: sum("BANCADO"),
    comisionesAcreditadas: sum("COMISION_REFERIDO", (e) => e.tipo === "GANANCIA"),
    comisionesPagadas: round2(
      eventos
        .filter((e) => e.categoria === "COMISION_REFERIDO" && e.tipo === "EGRESO")
        .reduce((acc, e) => acc + Math.abs(e.monto), 0)
    ),
  };

  // Series agrupadas por día / semana (lunes) / mes — mismo evento, tres agrupaciones, para que
  // el front cambie de granularidad sin pedir de nuevo.
  function agrupar(clave: (fecha: string) => string) {
    const map = new Map<
      string,
      { periodo: string; walletIngresos: number; walletEgresos: number; gananciaCierres: number; gananciaBancados: number; comisionesAcreditadas: number; comisionesPagadas: number }
    >();
    for (const e of eventos) {
      const k = clave(e.fecha);
      if (!map.has(k)) {
        map.set(k, {
          periodo: k,
          walletIngresos: 0,
          walletEgresos: 0,
          gananciaCierres: 0,
          gananciaBancados: 0,
          comisionesAcreditadas: 0,
          comisionesPagadas: 0,
        });
      }
      const fila = map.get(k)!;
      if (e.categoria === "WALLET") {
        if (e.monto > 0) fila.walletIngresos += e.monto;
        else fila.walletEgresos += Math.abs(e.monto);
      } else if (e.categoria === "CIERRE_SEMANAL") {
        fila.gananciaCierres += e.monto;
      } else if (e.categoria === "BANCADO") {
        fila.gananciaBancados += e.monto;
      } else if (e.categoria === "COMISION_REFERIDO") {
        if (e.tipo === "GANANCIA") fila.comisionesAcreditadas += e.monto;
        else if (e.tipo === "EGRESO") fila.comisionesPagadas += Math.abs(e.monto);
      }
    }
    return [...map.values()]
      .map((f) => ({
        ...f,
        walletIngresos: round2(f.walletIngresos),
        walletEgresos: round2(f.walletEgresos),
        gananciaCierres: round2(f.gananciaCierres),
        gananciaBancados: round2(f.gananciaBancados),
        comisionesAcreditadas: round2(f.comisionesAcreditadas),
        comisionesPagadas: round2(f.comisionesPagadas),
      }))
      .sort((a, b) => (a.periodo < b.periodo ? 1 : -1));
  }

  const porDia = agrupar((f) => f);
  const porSemana = agrupar((f) => lunesDe(f));
  const porMes = agrupar((f) => f.slice(0, 7));

  return { desde, hasta, totales, eventos, porDia, porSemana, porMes };
}
