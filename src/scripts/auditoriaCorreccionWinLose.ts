// AUDITORÍA de cierres WIN_LOSE ya aplicados, antes de decidir si/cómo corregirlos (30/09/2026,
// pedido explícito de Leo: "Antes de modificar datos históricos, hacé una auditoría... No
// recalculés ni sobrescribas automáticamente cierres históricos que ya tengan pagos parciales.
// Primero presentame el informe.").
//
// SOLO LECTURA -- este script no tiene modo --apply, no hace ningún INSERT/UPDATE/DELETE. Es
// el mismo tipo de diagnóstico que separarPendientePrepago.ts hizo en su momento para PREPAGO,
// pero acá se corta antes de la parte que corrige -- primero hay que ver el alcance real.
//
// Contexto (ver repo/closings.ts, corrección FINAL del 30/09/2026 -- confirmada por Leo con el
// ejemplo real de Tincho, "Total a pagar" = 227.76 = resultado + rakeback neto): hasta ahora, un
// cierre WIN_LOSE sumaba TODO (resultado de mesas + rakeback + rebate + rodeo + ajuste manual)
// directo al balance de fichas del agente. Con la corrección, el cierre deja de mover el
// balance (montoStock = 0), pero a diferencia de PREPAGO el monto que pasa a rakeback_pendiente
// es el cierre COMPLETO, resultado incluido -- en WIN_LOSE el resultado de mesas no se cuenta en
// ningún otro lado (no hay "fichas del agente" en Resumen para este sistema), así que tiene que
// viajar entero al pendiente para no perderse. Este script lista cada cierre WIN_LOSE ya
// aplicado bajo la lógica vieja, para ver qué haría falta corregir.
//
// Qué muestra por cada cierre:
//   - Resultado, rakeback, rebate, rodeo, ajuste manual, cierre final (como quedó guardado).
//   - Importe que HOY está de más en el balance bajo la regla nueva = el cierre final completo
//     (bajo la regla nueva, el cierre nunca debería haber tocado el balance).
//   - Corrección que se aplicaría: sacar ese monto del balance, crear un rakeback_pendiente por
//     el MISMO monto completo (cierre final, resultado incluido) -- a diferencia de PREPAGO, acá
//     no se excluye nada: es solo relocalizar la plata de "balance" a "pendiente", sin cambiar
//     el total que se le debe (o debe) al agente.
//   - Saldo ACTUAL del agente+club (para dar contexto: cuánto de ese balance sigue "vivo").
//   - Total cargado/descargado en ese agente+club DESDE esa semana en adelante (para detectar
//     movimiento posterior que puede haber consumido o mezclado esa plata -- balances.amount es
//     un acumulado corriente, no hay forma de aislar "estos dólares específicos" una vez que se
//     mezclaron con cargas/descargas reales; esto es información de contexto, no una respuesta
//     definitiva de "ya se gastó o no").
//
// IMPORTANTE: este informe NO decide una corrección automática. Un cierre con movimiento
// posterior importante (cargas/descargas grandes después de esa semana) probablemente necesita
// revisión caso por caso antes de tocar nada -- eso lo tiene que decidir Leo viendo el informe.
import { pool } from "../db/pool.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(Number(n)).toFixed(2);
}

async function main() {
  const r = await pool.query(
    `SELECT wc.id as closing_id, wc.agent_id, wc.club_id, wc.week_start, wc.week_end,
            wc.result, wc.rakeback, wc.rebate, wc.rodeo, wc.ajuste_manual, wc.final_closing,
            wc.status,
            a.name as agent_name, c.name as club_name,
            m.id as mov_id, m.amount as mov_amount, m.status as mov_status
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     LEFT JOIN ledger_movements m
       ON m.agent_id = wc.agent_id AND m.club_id = wc.club_id AND m.type = 'CIERRE_SEMANAL'
      AND m.occurred_at::date = wc.week_end::date AND m.status <> 'REVERTIDO'
     WHERE wc.system = 'WIN_LOSE' AND wc.status <> 'REVERTIDO'
     ORDER BY a.name, c.name, wc.week_start`
  );

  if (r.rows.length === 0) {
    console.log("No hay cierres WIN_LOSE activos -- nada para auditar.");
    await pool.end();
    return;
  }

  // Saldo actual por agente+club (para contexto).
  const saldos = await pool.query(`SELECT agent_id, club_id, amount FROM balances`);
  const saldoPorAgenteClub = new Map<string, number>();
  for (const s of saldos.rows) saldoPorAgenteClub.set(`${s.agent_id}|${s.club_id}`, Number(s.amount));

  console.log(`AUDITORÍA -- ${r.rows.length} cierre(s) WIN_LOSE activos bajo la lógica vieja (cierre movía el balance directo).\n`);
  console.log("Este informe es SOLO LECTURA. No modifica nada.\n");

  let totalIncorrectoBalance = 0;
  let totalAPendiente = 0; // cierre completo (resultado incluido) que debería pasar a rakeback_pendiente

  const porAgenteClub = new Map<string, { agentName: string; clubName: string; incorrecto: number; count: number }>();

  for (const row of r.rows) {
    const result = Number(row.result);
    const rakeback = Number(row.rakeback);
    const rebate = Number(row.rebate);
    const rodeo = Number(row.rodeo ?? 0);
    const ajuste = Number(row.ajuste_manual ?? 0);
    const finalClosing = Number(row.final_closing);
    const movAmount = row.mov_amount !== null ? Number(row.mov_amount) : null;

    // Bajo la regla nueva, el cierre completo (finalClosing) nunca debería haber tocado el
    // balance -- eso es "el importe incorrecto" que hoy está de más ahí.
    const importeIncorrectoEnBalance = movAmount !== null ? movAmount : finalClosing;
    // En WIN_LOSE el monto que corresponde pasar a rakeback_pendiente es el cierre COMPLETO,
    // resultado incluido -- no se excluye nada (a diferencia de PREPAGO).
    const aPendiente = finalClosing;

    totalIncorrectoBalance += importeIncorrectoEnBalance;
    totalAPendiente += aPendiente;

    const key = `${row.agent_id}|${row.club_id}`;
    const saldoActual = saldoPorAgenteClub.get(key) ?? 0;
    const acc = porAgenteClub.get(key) ?? { agentName: row.agent_name, clubName: row.club_name, incorrecto: 0, count: 0 };
    acc.incorrecto += importeIncorrectoEnBalance;
    acc.count += 1;
    porAgenteClub.set(key, acc);

    console.log(
      `${row.agent_name} — ${row.club_name} | semana ${String(row.week_start).slice(0, 10)} al ${String(row.week_end).slice(0, 10)} (cierre ${row.closing_id})`
    );
    console.log(
      `    resultado=${fmt(result)}  rakeback=${fmt(rakeback)}  rebate=${fmt(rebate)}  rodeo=${fmt(rodeo)}  ajuste=${fmt(ajuste)}  => cierre final=${fmt(finalClosing)}`
    );
    if (movAmount === null) {
      console.log(`    ⚠ No se encontró el movimiento CIERRE_SEMANAL asociado (¿reconstruido sin desglose? revisar a mano) -- se usa el cierre final como referencia.`);
    } else if (Math.abs(movAmount - finalClosing) > 0.01) {
      console.log(`    ⚠ El movimiento CIERRE_SEMANAL (${fmt(movAmount)}) no coincide con el cierre final guardado (${fmt(finalClosing)}) -- revisar a mano antes de corregir.`);
    }
    console.log(`    Importe incorrecto en balance (bajo la regla nueva no debería estar): ${fmt(importeIncorrectoEnBalance)}`);
    console.log(`    Corrección propuesta: sacar ${fmt(importeIncorrectoEnBalance)} del balance y crear un rakeback_pendiente nuevo por el mismo monto completo, ${fmt(aPendiente)} (resultado incluido) -- no cambia lo que se le debe al agente, solo lo relocaliza de balance a pendiente.`);
    console.log(`    Saldo ACTUAL del agente+club (contexto, incluye este y otros cierres/cargas/descargas): ${fmt(saldoActual)}`);
    console.log("");
  }

  // Movimiento posterior (cargas/descargas) por agente+club, desde la semana MÁS VIEJA de sus
  // cierres WIN_LOSE en adelante -- señal de si hubo actividad que pudo mezclarse con el saldo
  // mal acreditado.
  console.log("--- Resumen por agente+club ---\n");
  for (const [key, acc] of porAgenteClub) {
    const [agentId, clubId] = key.split("|");
    const primeraSemana = r.rows.find((row) => `${row.agent_id}|${row.club_id}` === key)?.week_start;
    const movs = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type = 'CARGA'), 0) as total_carga,
         COALESCE(SUM(amount) FILTER (WHERE type = 'DESCARGA'), 0) as total_descarga
       FROM ledger_movements
       WHERE agent_id = $1 AND club_id = $2 AND status <> 'REVERTIDO'
         AND occurred_at::date >= $3::date`,
      [agentId, clubId, primeraSemana]
    );
    const saldoActual = saldoPorAgenteClub.get(key) ?? 0;
    console.log(
      `${acc.agentName} — ${acc.clubName}: ${acc.count} cierre(s), importe incorrecto acumulado ${fmt(acc.incorrecto)}. ` +
        `Saldo actual: ${fmt(saldoActual)}. Cargas desde el primer cierre afectado: ${fmt(Number(movs.rows[0].total_carga))}, ` +
        `Descargas: ${fmt(Math.abs(Number(movs.rows[0].total_descarga)))}.`
    );
    if (saldoActual < acc.incorrecto - 0.01) {
      console.log(`    ⚠ El saldo actual es MENOR que el importe incorrecto acumulado -- probablemente ya se retiró/gastó parte de esa plata. Revisar a mano antes de corregir (no restar a ciegas).`);
    }
  }

  console.log("");
  console.log(`Total importe incorrecto en balance (todos los cierres): ${fmt(totalIncorrectoBalance)}`);
  console.log(`  Debería pasar completo (resultado incluido) a rakeback_pendiente: ${fmt(totalAPendiente)}`);
  console.log("");
  console.log("Este informe NO aplicó ningún cambio. Cuando Leo confirme cómo proceder, se puede");
  console.log("escribir la corrección (mismo patrón que separarPendientePrepago.ts) con dry-run");
  console.log("por defecto y --apply explícito, revisando caso por caso los que tengan la alerta");
  console.log("de saldo actual menor al importe incorrecto.");

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
