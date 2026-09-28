// Revertir TODOS los cruces ya aplicados (28/09/2026, pedido de Leo, "estamos probando") --
// un "cruce" es un CONSUMO puntual contra un adelanto de rakeback (rakeback_advances, botón
// "Aplicar cruces" en Liquidaciones) o contra una carga de tesorería pendiente
// (carga_pendientes_cruce, botón "Aplicar cruces" de cargas en Liquidaciones) -- ver
// repo/advances.ts y repo/cargaCruces.ts. Ya existe "Deshacer último cruce" en Liquidaciones.tsx,
// pero solo deshace el MÁS RECIENTE de cada adelanto/carga, uno a la vez -- esto hace lo mismo
// para TODOS, en bloque, reusando exactamente las mismas funciones del repo (misma validación,
// mismo criterio "solo el más reciente primero", nada de tocar la base a mano).
//
// El adelanto/carga en sí NO se borra ni se toca (amount, ALTA, AUMENTO, REDUCCION, BAJA,
// CORRECCION quedan igual) -- solo se deshacen los movimientos tipo CONSUMO, del más nuevo al
// más viejo, hasta volver a dejar cada uno en consumed=0 (o hasta toparse con algo que NO es un
// cruce por encima, en cuyo caso se frena ahí y se reporta para revisar a mano -- no se salta
// nada intermedio).
//
// NO TOCA: cierres (weekly_closings), movimientos de ledger que no sean el del propio cruce
// (los CONSUMO nunca generan movimiento de ledger -- ver ajustarAdelanto/consumirCarga), ni
// liquidaciones_guardadas.
//
//   - Sin --apply: SOLO IMPRIME qué se revertiría. No toca la base.
//   - Con --apply --confirmo: revierte de verdad, cruce por cruce (queda todo en el historial
//     de auditoría de cada tabla igual, solo que los CONSUMO se borran y consumed vuelve para
//     atrás -- mismo comportamiento que "Deshacer último cruce" a mano, repetido).
import { pool } from "../db/pool.js";
import { eliminarMovimientoAdelanto } from "../repo/advances.js";
import { eliminarMovimientoCarga } from "../repo/cargaCruces.js";

const APPLY = process.argv.includes("--apply") && process.argv.includes("--confirmo");

interface Mov {
  id: string;
  type: string;
  amount: string;
}

// Cuenta cuántos CONSUMO consecutivos hay al final (los más recientes) de una lista de
// movimientos ya ordenada por occurred_at/id DESC -- ese es el tramo que se puede revertir sin
// tocar nada que no sea un cruce. Si hay algo que NO es CONSUMO encima de un CONSUMO viejo, ese
// viejo queda bloqueado (se reporta, no se toca).
function tramoRevertible(movsDesc: Mov[]) {
  let i = 0;
  while (i < movsDesc.length && movsDesc[i].type === "CONSUMO") i++;
  const revertibles = movsDesc.slice(0, i);
  const bloqueadosMasViejos = movsDesc.slice(i).filter((m) => m.type === "CONSUMO");
  return { revertibles, bloqueadosMasViejos };
}

async function main() {
  console.log(APPLY ? "MODO: APLICAR (revierte cruces de verdad)\n" : "MODO: SOLO REPORTE (no se toca nada)\n");

  // --- Adelantos de rakeback ---
  const advIds = (
    await pool.query(`SELECT DISTINCT advance_id FROM rakeback_advance_movements WHERE type = 'CONSUMO'`)
  ).rows.map((r) => r.advance_id as string);

  let advRevertidos = 0;
  let advMontoTotal = 0;
  let advBloqueados = 0;
  const advErrores: string[] = [];

  for (const advanceId of advIds) {
    const movs: Mov[] = (
      await pool.query(
        `SELECT id, type, amount FROM rakeback_advance_movements WHERE advance_id = $1 ORDER BY occurred_at DESC, id DESC`,
        [advanceId]
      )
    ).rows;
    const { revertibles, bloqueadosMasViejos } = tramoRevertible(movs);
    advBloqueados += bloqueadosMasViejos.length;
    for (const m of revertibles) {
      advMontoTotal += Number(m.amount);
      advRevertidos++;
      if (APPLY) {
        try {
          await eliminarMovimientoAdelanto(m.id);
        } catch (err: any) {
          advErrores.push(`Adelanto ${advanceId}, movimiento ${m.id}: ${err.message}`);
        }
      }
    }
  }

  console.log(`Adelantos de rakeback (cruces / CONSUMO):`);
  console.log(`  adelantos con al menos un cruce   ${advIds.length}`);
  console.log(`  cruces a revertir                 ${advRevertidos}  (${advMontoTotal.toFixed(2)} USD)`);
  if (advBloqueados > 0) {
    console.log(
      `  ⚠️  ${advBloqueados} cruce(s) viejo(s) quedan BLOQUEADOS porque hay un AUMENTO/REDUCCION/BAJA/CORRECCION` +
        ` aplicado encima -- revisalos a mano en Adelantos si también hace falta deshacerlos.`
    );
  }

  // --- Cargas de tesorería pendientes ---
  const cargaIds = (
    await pool.query(`SELECT DISTINCT carga_id FROM carga_cruce_movements WHERE type = 'CONSUMO'`)
  ).rows.map((r) => r.carga_id as string);

  let cargaRevertidos = 0;
  let cargaMontoTotal = 0;
  let cargaBloqueados = 0;
  const cargaErrores: string[] = [];

  for (const cargaId of cargaIds) {
    const movs: Mov[] = (
      await pool.query(
        `SELECT id, type, amount FROM carga_cruce_movements WHERE carga_id = $1 ORDER BY occurred_at DESC, id DESC`,
        [cargaId]
      )
    ).rows;
    const { revertibles, bloqueadosMasViejos } = tramoRevertible(movs);
    cargaBloqueados += bloqueadosMasViejos.length;
    for (const m of revertibles) {
      cargaMontoTotal += Number(m.amount);
      cargaRevertidos++;
      if (APPLY) {
        try {
          await eliminarMovimientoCarga(m.id);
        } catch (err: any) {
          cargaErrores.push(`Carga ${cargaId}, movimiento ${m.id}: ${err.message}`);
        }
      }
    }
  }

  console.log(`\nCargas de tesorería pendientes (cruces / CONSUMO):`);
  console.log(`  cargas con al menos un cruce      ${cargaIds.length}`);
  console.log(`  cruces a revertir                 ${cargaRevertidos}  (${cargaMontoTotal.toFixed(2)} USD)`);
  if (cargaBloqueados > 0) {
    console.log(
      `  ⚠️  ${cargaBloqueados} cruce(s) viejo(s) quedan BLOQUEADOS -- (no debería pasar acá, las cargas` +
        ` solo tienen ALTA/CONSUMO, pero se reporta por las dudas).`
    );
  }

  if (advErrores.length > 0 || cargaErrores.length > 0) {
    console.log(`\nErrores durante la aplicación:`);
    [...advErrores, ...cargaErrores].forEach((e) => console.log(`  - ${e}`));
  }

  if (!APPLY) {
    console.log(
      "\nNo se tocó nada. Para aplicar de verdad: npx tsx src/scripts/revertirTodosLosCruces.ts --apply --confirmo"
    );
  } else {
    console.log(`\nListo. ${advRevertidos} cruce(s) de adelantos y ${cargaRevertidos} cruce(s) de cargas revertidos.`);
  }
  await pool.end();
}

main();
