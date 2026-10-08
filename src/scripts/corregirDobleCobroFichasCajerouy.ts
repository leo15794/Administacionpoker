// Corrección puntual (08/10/2026, pedido de Leo) del bug real que encontró con cajerouy /
// Fénix Suprema: cruzar un adelanto de fichas (FICHAS_PENDIENTE) generaba un COBRO que restaba
// la deuda OTRA VEZ del balance, encima de lo que ya había restado el Alta (ADELANTO_FICHAS) --
// ver el fix en registrarMovimientoLedger/ajustarAdelanto (repo/ledger.ts, repo/advances.ts,
// balanceDeltaOverride). Eso ya está arreglado para los cruces NUEVOS; este script corrige el
// balance de cajerouy, que ya quedó duplicado por los 6 cruces reales que se aplicaron hoy
// (620+100+400+100+122+550 = 1892) ANTES del fix.
//
// Suma un único AJUSTE de +1892 (mismo tipo/mecanismo que "Ajuste manual de fichas" que ya usa
// Resumen.tsx para corregir a mano) -- no toca ni borra ningún movimiento existente, todo queda
// en el historial. Idempotente por idempotencyKey: correrlo dos veces es un no-op la segunda vez.
//
// Dry-run por default. Para aplicar de verdad: tsx src/scripts/corregirDobleCobroFichasCajerouy.ts --apply
import { pool } from "../db/pool.js";
import { registrarMovimiento } from "../repo/ledger.js";

const AGENT_ID = "agent_ldq0ckcdmtsqfhdk"; // cajerouy
const CLUB_ID = "club_q10zfrfbmtsqffec"; // Fénix Suprema
const MONTO = 1892; // 620+100+400+100+122+550, los 6 adelantos de fichas cruzados hoy
const IDEMPOTENCY_KEY = "correccion_doble_cobro_fichas_pendiente:" + AGENT_ID + ":" + CLUB_ID + ":2026-10-08";

async function main() {
  const apply = process.argv.includes("--apply");

  const balRes = await pool.query(`SELECT amount FROM balances WHERE agent_id=$1 AND club_id=$2`, [AGENT_ID, CLUB_ID]);
  const balanceActual = Number(balRes.rows[0]?.amount ?? 0);

  const yaRes = await pool.query(
    `SELECT id FROM ledger_movements WHERE idempotency_key=$1 AND status <> 'REVERTIDO'`,
    [IDEMPOTENCY_KEY]
  );
  if (yaRes.rows.length > 0) {
    console.log("Ya se aplicó esta corrección antes (idempotency_key ya existe) -- no hace nada. mov id:", yaRes.rows[0].id);
    return;
  }

  console.log(`Balance actual cajerouy / Fénix Suprema: US$ ${balanceActual.toFixed(2)}`);
  console.log(`Corrección a aplicar: AJUSTE +US$ ${MONTO.toFixed(2)}`);
  console.log(`Balance resultante: US$ ${(balanceActual + MONTO).toFixed(2)}`);

  if (!apply) {
    console.log("\nDRY-RUN -- no se aplicó nada. Para aplicar de verdad: --apply");
    return;
  }

  const r = await registrarMovimiento({
    idempotencyKey: IDEMPOTENCY_KEY,
    type: "AJUSTE",
    clubId: CLUB_ID,
    agentId: AGENT_ID,
    amount: MONTO,
    paymentMethod: "SIN_TESORERIA",
    occurredAt: new Date(),
    observation:
      "Corrección: los 6 cruces de adelanto de fichas de hoy (620+100+400+100+122+550=1892) restaron la deuda dos veces del balance (una vez en el Alta, otra vez en el Cobro del cruce) por un bug ya corregido. Este ajuste saca el doble conteo, no cambia nada real.",
    createdBy: "correccion-script",
  });
  console.log("Aplicado. Movimiento:", r.id);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });
