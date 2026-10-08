// Segunda reversion puntual (08/10/2026, pedido de Leo) de la sesion de cajerouy / Fenix
// Suprema: el primer revert (revertirSesionCajerouyHoy.ts) se corrio bien, pero Leo rehizo los
// cruces y el cobro de 1455 ANTES de que el fix (balanceDeltaOverride, commits 1640d29/04818ea/
// 57ecdc7) llegara a produccion en Vercel -- entonces el codigo viejo volvio a duplicar la
// deuda exactamente igual que la primera vez. Ya esta deployado (dpl_NfQ64BFUncv1PCibggAzZ4gqFuHx,
// commit 57ecdc7, READY) -- este script revierte esta SEGUNDA tanda de movimientos (distintos
// ids de la primera, ver revertirSesionCajerouyHoy.ts) para recien ahi rehacerlo de nuevo ya
// con el fix de verdad corriendo.
//
// Orden: primero el COBRO de 1455 (mas reciente), despues los 6 consumos de adelanto de fichas
// (cada uno revierte su COBRO ligado), despues el cruce CRUCE_ADELANTO de rakeback pendiente.
//
// Dry-run por default. Para aplicar de verdad:
//   tsx src/scripts/revertirSesionCajerouyHoyRound2.ts --apply
import { pool } from "../db/pool.js";
import { eliminarMovimiento } from "../repo/ledger.js";
import { eliminarMovimientoAdelanto } from "../repo/advances.js";
import { revertirPagoPendiente } from "../repo/rakebackPendiente.js";

const COBRO_1455_ID = "mov_j6rybkoimuzyeosn";

const ADELANTO_CONSUMO_IDS = [
  "advmov_kkwgumonmuzye48i", // 620
  "advmov_2n32mcqpmuzye4yg", // 100
  "advmov_1ey75590muzye57y", // 400
  "advmov_sxcxtt1hmuzye5ht", // 100
  "advmov_fn02zykumuzye5rc", // 122
  "advmov_xv5qoz7dmuzye611", // 550
];

const CRUCE_ADELANTO_PENDIENTE_ID = "rpm_v2pf735tmuzye4oq"; // rp_ph4kaeidmuyevuqp, 258.7575

async function main() {
  const apply = process.argv.includes("--apply");

  const agentId = "agent_ldq0ckcdmtsqfhdk"; // cajerouy
  const clubId = "club_q10zfrfbmtsqffec"; // Fenix Suprema

  const balRes = await pool.query(`SELECT amount FROM balances WHERE agent_id=$1 AND club_id=$2`, [agentId, clubId]);
  console.log(`Balance actual cajerouy / Fenix Suprema: US$ ${Number(balRes.rows[0]?.amount ?? 0).toFixed(2)}`);

  console.log("\nSe va a revertir, en orden:");
  console.log(`  1. COBRO 1455 (${COBRO_1455_ID})`);
  console.log(`  2. 6 consumos de adelanto de fichas (${ADELANTO_CONSUMO_IDS.join(", ")})`);
  console.log(`  3. Cruce CRUCE_ADELANTO de rakeback pendiente (${CRUCE_ADELANTO_PENDIENTE_ID})`);

  if (!apply) {
    console.log("\nDRY-RUN -- no se revirtio nada. Para aplicar de verdad: --apply");
    await pool.end();
    return;
  }

  console.log("\n1) Revirtiendo COBRO 1455...");
  await eliminarMovimiento(COBRO_1455_ID, { ignorarOrden: true });
  console.log("   OK");

  console.log("2) Revirtiendo los 6 consumos de adelanto de fichas...");
  for (const id of ADELANTO_CONSUMO_IDS) {
    await eliminarMovimientoAdelanto(id);
    console.log(`   OK ${id}`);
  }

  console.log("3) Revirtiendo cruce CRUCE_ADELANTO de rakeback pendiente...");
  await revertirPagoPendiente(CRUCE_ADELANTO_PENDIENTE_ID);
  console.log("   OK");

  const balRes2 = await pool.query(`SELECT amount FROM balances WHERE agent_id=$1 AND club_id=$2`, [agentId, clubId]);
  console.log(`\nBalance final cajerouy / Fenix Suprema: US$ ${Number(balRes2.rows[0]?.amount ?? 0).toFixed(2)}`);
  console.log("Deberia haber quedado en -US$ 221,85 (lo que quedo tras el primer revert, antes de rehacer los cruces de nuevo).");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
