// Test de integración end-to-end del flujo de rakeback pendiente (22/09/2026, pedido de Leo:
// "revisa que funcione todo ok"). Corre contra la base real pero usa un agente y un club de
// PRUEBA propios (nombres con prefijo "TEST-QA-"), y se autolimpia al final SIEMPRE (pase o
// falle algún paso) -- no debería dejar ningún rastro.
//
// Ejercita en orden:
//   1. Aplicar un cierre semanal genérico y verificar que el ledger/balance solo se mueve por
//      el Win/Lose (result), no por el cierre económico completo (final_closing).
//   2. Verificar que se creó la fila de rakeback_pendiente con el monto correcto (la diferencia).
//   3. Pagar una parte en FICHAS -> tiene que mover el stock (balance sube).
//   4. Pagar el resto en USDT -> NO tiene que mover el stock (balance queda igual).
//   5. Que un pago que se pasa del pendiente disponible se rechace.
//   6. Que no se pueda revertir el cierre ni borrar el pendiente una vez que ya se pagó algo.
//
// Sin --run: solo describe los pasos, no toca la base. Con --run: ejecuta todo de verdad
// contra la base configurada en DATABASE_URL (¡asegurate de que sea la de desarrollo/pruebas,
// no producción, si esto se corre después de un reset!).
//
// npx tsx src/scripts/testRakebackPendienteFlujo.ts --run

import { pool } from "../db/pool.js";
import { upsertAgent, upsertClub } from "../repo/catalog.js";
import { aplicarCierreSemanal, revertirCierreSemanal } from "../repo/closings.js";
import { pagarPendiente, eliminarPendiente, listRakebackPendiente } from "../repo/rakebackPendiente.js";
import { getBalance } from "../repo/ledger.js";

const RUN = process.argv.includes("--run");
const AGENT_NAME = "TEST-QA-RakebackAgente";
const CLUB_NAME = "TEST-QA-RakebackClub";

let pasos = 0;
let fallos = 0;

function ok(desc: string, cond: boolean, detalle?: string) {
  pasos++;
  if (cond) {
    console.log(`  ✅ ${desc}`);
  } else {
    fallos++;
    console.log(`  ❌ ${desc}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

async function esperarError(desc: string, fn: () => Promise<any>) {
  pasos++;
  try {
    await fn();
    fallos++;
    console.log(`  ❌ ${desc} -- se esperaba que tirara error y NO tiró.`);
  } catch (err: any) {
    console.log(`  ✅ ${desc} (rechazado correctamente: "${err.message}")`);
  }
}

async function limpiar(agentId: string, clubId: string) {
  if (!agentId || !clubId) return;
  await pool.query(`DELETE FROM rakeback_pendiente_movements WHERE agent_id = $1`, [agentId]);
  await pool.query(`DELETE FROM rakeback_pendiente WHERE agent_id = $1`, [agentId]);
  // Un pago en FICHAS crea una carga_pendientes_cruce que referencia el movimiento (ver
  // repo/ledger.ts) -- hay que borrarla ANTES del ledger_movements o la FK lo rechaza (bug
  // encontrado el 22/09/2026 corriendo este mismo test).
  await pool.query(
    `DELETE FROM carga_cruce_movements WHERE carga_id IN (SELECT id FROM carga_pendientes_cruce WHERE agent_id = $1)`,
    [agentId]
  );
  await pool.query(`DELETE FROM carga_pendientes_cruce WHERE agent_id = $1`, [agentId]);
  await pool.query(`DELETE FROM treasury_entries WHERE movement_id IN (SELECT id FROM ledger_movements WHERE agent_id = $1)`, [agentId]);
  await pool.query(`DELETE FROM ledger_movements WHERE agent_id = $1`, [agentId]);
  await pool.query(`DELETE FROM balances WHERE agent_id = $1`, [agentId]);
  await pool.query(`DELETE FROM weekly_closings WHERE agent_id = $1`, [agentId]);
  await pool.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
  await pool.query(`DELETE FROM clubs WHERE id = $1`, [clubId]);
  console.log(`\nLimpieza: se borró todo rastro de "${AGENT_NAME}" / "${CLUB_NAME}".`);
}

async function main() {
  console.log(
    RUN
      ? "MODO: EJECUTAR de verdad (crea y borra datos de prueba en la base configurada)\n"
      : "MODO: SOLO DESCRIPCIÓN (pasá --run para ejecutarlo de verdad)\n"
  );

  if (!RUN) {
    console.log("Pasos que se ejecutarían:");
    console.log("  1. Crear agente/club de prueba.");
    console.log("  2. Aplicar cierre: result=-200, rakeback=500 (rakebackPct 50% de un rake de 1000) -> final_closing=300.");
    console.log("  3. Verificar que el ledger/balance quedan en -200 (Win/Lose), no en 300.");
    console.log("  4. Verificar rakeback_pendiente = 500.");
    console.log("  5. Pagar 200 en FICHAS -> balance pasa a 0 (se movió el stock).");
    console.log("  6. Pagar 300 en USDT -> balance sigue en 0 (no se mueve el stock).");
    console.log("  7. Verificar que pagar de más se rechaza, y que revertir/eliminar con pago ya hecho se rechaza.");
    console.log("  8. Borrar todo lo de prueba.");
    console.log("\nCorré con --run para ejecutarlo de verdad.");
    return;
  }

  let agentId: string = "";
  let clubId: string = "";

  try {
    console.log("── Paso 1: crear agente/club de prueba ──");
    const club = await upsertClub(CLUB_NAME);
    const agent = await upsertAgent(AGENT_NAME, "WIN_LOSE");
    agentId = agent.id;
    clubId = club.id;
    console.log(`  agente=${agentId} club=${clubId}`);

    console.log("\n── Paso 2: aplicar cierre semanal ──");
    const cierre = await aplicarCierreSemanal({
      agentId,
      clubId,
      weekStart: "2026-01-05",
      weekEnd: "2026-01-11",
      system: "WIN_LOSE",
      result: -200,
      rakeTotal: 1000,
      rakebackPct: 0.5,
      rebatePct: 0,
    });
    ok("Cierre aplicado sin error", !cierre.alreadyApplied);
    const finalClosingObtenido = cierre.calc?.finalClosing ?? NaN;
    ok(`finalClosing = 300 (calc.finalClosing=${finalClosingObtenido})`, Math.abs(finalClosingObtenido - 300) < 0.01);

    console.log("\n── Paso 3: verificar que el balance/ledger quedaron en el Win/Lose, no en el final_closing ──");
    const movRes = await pool.query(
      `SELECT * FROM ledger_movements WHERE agent_id = $1 AND club_id = $2 AND type = 'CIERRE_SEMANAL'`,
      [agentId, clubId]
    );
    ok("Existe 1 movimiento CIERRE_SEMANAL", movRes.rows.length === 1, `encontrados: ${movRes.rows.length}`);
    const montoLedger = movRes.rows[0] ? Number(movRes.rows[0].amount) : NaN;
    ok(`Movimiento CIERRE_SEMANAL = -200 (Win/Lose), no 300 (obtuvo ${montoLedger})`, Math.abs(montoLedger - -200) < 0.01);

    const bal1 = await getBalance(agentId, clubId);
    const saldo1 = bal1 ? Number(bal1.amount) : 0;
    ok(`Balance del agente = -200 tras el cierre (obtuvo ${saldo1})`, Math.abs(saldo1 - -200) < 0.01);

    console.log("\n── Paso 4: verificar rakeback_pendiente ──");
    const pendientes = await listRakebackPendiente();
    const miPendiente = pendientes.find((p: any) => p.agent_id === agentId);
    ok("Se creó la fila de rakeback_pendiente", !!miPendiente);
    ok(`rakeback_pendiente.amount = 500 (obtuvo ${miPendiente?.amount})`, !!miPendiente && Math.abs(Number(miPendiente.amount) - 500) < 0.01);
    ok(`rakeback_pendiente.consumed = 0 (obtuvo ${miPendiente?.consumed})`, !!miPendiente && Number(miPendiente.consumed) === 0);

    if (!miPendiente) throw new Error("No se puede seguir el test sin la fila de rakeback_pendiente.");

    console.log("\n── Paso 5: pagar 200 en FICHAS -- tiene que mover el stock ──");
    await pagarPendiente({ pendienteId: miPendiente.id, amount: 200, medio: "FICHAS" });
    const bal2 = await getBalance(agentId, clubId);
    const saldo2 = bal2 ? Number(bal2.amount) : 0;
    ok(`Balance sube a 0 tras pagar 200 en fichas (obtuvo ${saldo2})`, Math.abs(saldo2 - 0) < 0.01);

    console.log("\n── Paso 6: pagar los 300 restantes en USDT -- NO tiene que mover el stock ──");
    await pagarPendiente({ pendienteId: miPendiente.id, amount: 300, medio: "USDT" });
    const bal3 = await getBalance(agentId, clubId);
    const saldo3 = bal3 ? Number(bal3.amount) : 0;
    ok(`Balance sigue en 0 tras pagar 300 en USDT (obtuvo ${saldo3})`, Math.abs(saldo3 - 0) < 0.01);

    const treasuryRes = await pool.query(
      `SELECT te.* FROM treasury_entries te JOIN ledger_movements m ON m.id = te.movement_id WHERE m.agent_id = $1 AND m.type = 'PAGO'`,
      [agentId]
    );
    ok("El pago en USDT generó su entrada de tesorería (EGRESO)", treasuryRes.rows.length === 1 && treasuryRes.rows[0].direction === "EGRESO");

    console.log("\n── Paso 7: casos que tienen que fallar ──");
    await esperarError("Pagar más del pendiente disponible (ya está en 0) se rechaza", () =>
      pagarPendiente({ pendienteId: miPendiente.id, amount: 1, medio: "USDT" })
    );
    await esperarError("Revertir el cierre con el pendiente ya pagado se rechaza", () => revertirCierreSemanal(cierre.id));
    await esperarError("Eliminar el pendiente ya pagado se rechaza", () => eliminarPendiente(miPendiente.id));

    console.log(`\n${fallos === 0 ? "✅ TODO OK" : `❌ ${fallos} de ${pasos} verificaciones fallaron`} -- ${pasos} verificaciones en total.`);
  } catch (err) {
    fallos++;
    console.error("\n💥 Error inesperado durante el test:", err);
  } finally {
    await limpiar(agentId, clubId);
    await pool.end();
    process.exitCode = fallos > 0 ? 1 : 0;
  }
}

main();
