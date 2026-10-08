// Reversion puntual (08/10/2026, pedido de Leo) de TODA la sesion de hoy con cajerouy / Fenix
// Suprema: Leo confirmo que el cobro de 1455 fue plata real, pero pidio tirar todo para atras
// y rehacerlo de nuevo ahora que el bug de doble conteo (ver corregirDobleCobroFichasCajerouy.ts,
// repo/ledger.ts balanceDeltaOverride, repo/advances.ts) ya esta arreglado en el codigo.
//
// Revierte, en este orden (importa el orden: eliminarMovimiento sin ignorarOrden exige que se
// revierta primero el movimiento MAS RECIENTE del agente+club en el ledger general):
//   1. El COBRO de 1455 (el mas reciente de todos, registrado 18:51:27).
//   2. El AJUSTE de +1892 que corrigio el doble conteo (registrado 18:45:09, mas viejo que el 1).
//   3. Los 6 CONSUMO de adelantos de fichas (eliminarMovimientoAdelanto) -- cada uno revierte
//      tambien su COBRO ligado via mov.movement_id.
//   4. El pago CRUCE_ADELANTO de rakeback pendiente (revertirPagoPendiente) -- revierte el
//      ledger ligado y recalcula la cadena de pendientes.
//
// Dry-run por default (solo muestra que va a hacer). Para aplicar de verdad:
//   tsx src/scripts/revertirSesionCajerouyHoy.ts --apply
import { pool } from "../db/pool.js";
import { eliminarMovimiento } from "../repo/ledger.js";
import { eliminarMovimientoAdelanto } from "../repo/advances.js";
import { revertirPagoPendiente } from "../repo/rakebackPendiente.js";

const COBRO_1455_ID = "mov_n0acivadmuzw7ctb";
const AJUSTE_1892_ID = "mov_z6l3fantmuzvz9jc";

const ADELANTO_CONSUMO_IDS = [
  "advmov_mpkuj9oemuzudq6s", // 620
  "advmov_u7wk3ufcmuzudqr4", // 100
  "advmov_qc3uunaamuzudr0o", // 400
  "advmov_qriz8wrgmuzudra7", // 100
  "advmov_q9n8uhgnmuzudrii", // 122
  "advmov_00pxw6hzmuzudrqx", // 550
];

const CRUCE_ADELANTO_PENDIENTE_ID = "rpm_m2n7blynmuzudqit"; // rp_ph4kaeidmuyevuqp, 258.7575

async function main() {
  const apply = process.argv.includes("--apply");

  const agentId = "agent_ldq0ckcdmtsqfhdk"; // cajerouy
  const clubId = "club_q10zfrfbmtsqffec"; // Fenix Suprema

  const balRes = await pool.query(`SELECT amount FROM balances WHERE agent_id=$1 AND club_id=$2`, [agentId, clubId]);
  console.log(`Balance actual cajerouy / Fenix Suprema: US$ ${Number(balRes.rows[0]?.amount ?? 0).toFixed(2)}`);

  console.log("\nSe va a revertir, en orden:");
  console.log(`  1. COBRO 1455 (${COBRO_1455_ID})`);
  console.log(`  2. AJUSTE +1892 (${AJUSTE_1892_ID})`);
  console.log(`  3. 6 consumos de adelanto de fichas (${ADELANTO_CONSUMO_IDS.join(", ")})`);
  console.log(`  4. Pago CRUCE_ADELANTO de rakeback pendiente (${CRUCE_ADELANTO_PENDIENTE_ID})`);

  if (!apply) {
    console.log("\nDRY-RUN -- no se revirtio nada. Para aplicar de verdad: --apply");
    await pool.end();
    return;
  }

  console.log("\n1) Revirtiendo COBRO 1455...");
  await eliminarMovimiento(COBRO_1455_ID, { ignorarOrden: true });
  console.log("   OK");

  console.log("2) Revirtiendo AJUSTE +1892...");
  await eliminarMovimiento(AJUSTE_1892_ID, { ignorarOrden: true });
  console.log("   OK");

  console.log("3) Revirtiendo los 6 consumos de adelanto de fichas...");
  for (const id of ADELANTO_CONSUMO_IDS) {
    await eliminarMovimientoAdelanto(id);
    console.log(`   OK ${id}`);
  }

  console.log("4) Revirtiendo pago CRUCE_ADELANTO de rakeback pendiente...");
  await revertirPagoPendiente(CRUCE_ADELANTO_PENDIENTE_ID);
  console.log("   OK");

  const balRes2 = await pool.query(`SELECT amount FROM balances WHERE agent_id=$1 AND club_id=$2`, [agentId, clubId]);
  console.log(`\nBalance final cajerouy / Fenix Suprema: US$ ${Number(balRes2.rows[0]?.amount ?? 0).toFixed(2)}`);
  console.log("Listo. Revisa en Movimientos/Liquidaciones que haya quedado todo como antes de hoy.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
