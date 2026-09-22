// Reset ACOTADO de Adelantos de rakeback + Liquidaciones guardadas (22/09/2026, pedido de
// Leo, "estamos probando") -- a diferencia de resetDatosFinancieros.ts (que borra TODO:
// cierres, movimientos, cargas, etc.), esto SOLO toca:
//   - rakeback_advances / rakeback_advance_movements (Adelantos)
//   - liquidaciones_guardadas (el historial de "Guardar en historial" de Liquidaciones)
//
// Desde que los adelantos en FICHAS/USDT mueven stock/wallet de verdad (22/09/2026, ver
// repo/advances.ts), no alcanza con borrar esas dos tablas: primero hay que deshacer el
// movimiento de ledger real que cada Alta/Aumento generó (repo/ledger.ts eliminarMovimiento),
// para que el balance del agente y la wallet queden como si el adelanto nunca hubiera existido.
// Un adelanto viejo (medio = NULL, de antes de ese cambio) no tiene movimiento que deshacer.
//
// NO TOCA: cierres, ledger_movements de otro tipo, cargas de tesorería pendientes
// (carga_pendientes_cruce/carga_cruce_movements -- esas nacen de "Cargar movimiento", no de
// Adelantos), rakeback_pendiente, balances de agentes que no tengan un adelanto.
//
//   - Sin --apply: SOLO IMPRIME qué se borraría. No toca la base.
//   - Con --apply --confirmo: borra de verdad. Irreversible.
import { pool } from "../db/pool.js";
import { eliminarMovimiento } from "../repo/ledger.js";

const APPLY = process.argv.includes("--apply") && process.argv.includes("--confirmo");

async function main() {
  console.log(APPLY ? "MODO: APLICAR (esto borra datos de verdad, no se puede deshacer)\n" : "MODO: SOLO REPORTE (no se toca nada)\n");

  const advances = await pool.query(`SELECT id FROM rakeback_advances`);
  const movs = await pool.query(
    `SELECT ram.id as advmov_id, ram.advance_id, ram.movement_id, lm.occurred_at
     FROM rakeback_advance_movements ram
     JOIN ledger_movements lm ON lm.id = ram.movement_id
     WHERE ram.movement_id IS NOT NULL
     ORDER BY lm.occurred_at DESC, lm.id DESC`
  );
  const liquidaciones = await pool.query(`SELECT COUNT(*)::int as n FROM liquidaciones_guardadas`);
  const cargasConConsumo = await pool.query(`SELECT COUNT(*)::int as n FROM carga_pendientes_cruce WHERE consumed > 0`);

  console.log(`  rakeback_advances                     ${advances.rows.length} fila(s)`);
  console.log(`  ↳ con movimiento real de ledger vinculado (fichas/USDT)  ${movs.rows.length}`);
  console.log(`  liquidaciones_guardadas                ${liquidaciones.rows[0].n} fila(s)`);

  if (cargasConConsumo.rows[0].n > 0) {
    console.log(
      `\n⚠️  Hay ${cargasConConsumo.rows[0].n} carga(s) de tesorería con algo cruzado (consumed > 0) -- ` +
        `esto NO se toca acá (nacen de "Cargar movimiento", no de Adelantos). Avisame si también querés resetear esos cruces.`
    );
  }

  if (!APPLY) {
    console.log("\nNo se borró nada. Para aplicar de verdad: npx tsx src/scripts/resetAdelantosYLiquidaciones.ts --apply --confirmo");
    await pool.end();
    return;
  }

  console.log("\nBorrando...");
  let movsRevertidos = 0;
  const errores: string[] = [];
  for (const m of movs.rows) {
    try {
      await eliminarMovimiento(m.movement_id);
      movsRevertidos++;
    } catch (err: any) {
      errores.push(`Adelanto ${m.advance_id}, movimiento ${m.movement_id}: ${err.message}`);
    }
  }
  if (errores.length > 0) {
    console.log(`\n${errores.length} movimiento(s) de ledger NO se pudieron deshacer (no eran el más reciente de ese agente+club):`);
    errores.forEach((e) => console.log(`  - ${e}`));
    console.log("Igual se borra el resto abajo -- esas filas van a quedar sueltas en Movimientos (revisalas a mano si hace falta).");
  }

  await pool.query("DELETE FROM rakeback_advance_movements");
  await pool.query("DELETE FROM rakeback_advances");
  await pool.query("DELETE FROM liquidaciones_guardadas");

  console.log(
    `\nListo. ${movsRevertidos} movimiento(s) de ledger revertidos, ${advances.rows.length} adelanto(s) y ${liquidaciones.rows[0].n} liquidación(es) guardada(s) borrados.`
  );
  await pool.end();
}

main();
