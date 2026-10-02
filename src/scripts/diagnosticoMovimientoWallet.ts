// Diagnóstico de arranque para el caso "probé 'mueve Wallet' en Cuentas de socios y no impactó
// en la Wallet" (02/10/2026). 100% LECTURA, no toca nada.
//
// Muestra, lado a lado:
//   1. Los últimos movimientos de Cuentas de socios (partner_account_entries), con su
//      treasury_adjustment_id si tienen uno vinculado -- y si lo tienen, los datos del ajuste
//      real de Tesorería al que apuntan (ledger/dirección/monto/status).
//   2. Los últimos ajustes de Tesorería con ledger=WALLET_MANOS, estén o no vinculados a algún
//      movimiento de Cuentas de socios -- para detectar si el ajuste SÍ se creó pero quedó
//      "huérfano" (sin el id guardado de vuelta en partner_account_entries).
//
// Uso: tsx src/scripts/diagnosticoMovimientoWallet.ts
import { pool } from "../db/pool.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  console.log("######## Últimos 15 movimientos de Cuentas de socios ########\n");
  const entries = await pool.query(
    `SELECT e.id, e.concept, e.amount, e.category, e.entry_date, e.created_at, e.treasury_adjustment_id,
            pa.name as account_name,
            t.ledger, t.direction, t.amount as t_amount, t.status as t_status, t.occurred_at as t_occurred_at, t.reason as t_reason
     FROM partner_account_entries e
     JOIN partner_accounts pa ON pa.id = e.account_id
     LEFT JOIN treasury_adjustments t ON t.id = e.treasury_adjustment_id
     ORDER BY e.created_at DESC
     LIMIT 15`
  );
  for (const e of entries.rows) {
    console.log(`--- ${e.account_name} — "${e.concept}" (${fmt(Number(e.amount))}) ---`);
    console.log(`    id=${e.id} | categoria=${e.category} | fecha=${String(e.entry_date).slice(0, 10)} | cargado=${e.created_at}`);
    if (!e.treasury_adjustment_id) {
      console.log(`    treasury_adjustment_id: (ninguno — no está marcado como "mueve Wallet")`);
    } else if (!e.ledger) {
      console.log(`    treasury_adjustment_id=${e.treasury_adjustment_id}  <-- ATENCIÓN: apunta a un id que NO existe en treasury_adjustments.`);
    } else {
      console.log(`    treasury_adjustment_id=${e.treasury_adjustment_id} -> Wallet: ${e.ledger} ${e.direction} ${fmt(Number(e.t_amount))} (status=${e.t_status}, ocurrido=${e.t_occurred_at})`);
      console.log(`    reason del ajuste: "${e.t_reason}"`);
    }
    console.log("");
  }

  console.log("\n######## Últimos 10 ajustes de Tesorería en WALLET_MANOS (todos, linkeados o no) ########\n");
  const ajustes = await pool.query(
    `SELECT a.id, a.direction, a.amount, a.status, a.reason, a.occurred_at, a.created_at, a.created_by,
            e.id as entry_id, e.concept as entry_concept
     FROM treasury_adjustments a
     LEFT JOIN partner_account_entries e ON e.treasury_adjustment_id = a.id
     WHERE a.ledger = 'WALLET_MANOS'
     ORDER BY a.created_at DESC
     LIMIT 10`
  );
  for (const a of ajustes.rows) {
    console.log(`--- [${a.id}] ${a.direction} ${fmt(Number(a.amount))} (status=${a.status}) ---`);
    console.log(`    reason: "${a.reason}"`);
    console.log(`    ocurrido=${a.occurred_at} | cargado=${a.created_at} | created_by=${a.created_by ?? "(nadie)"}`);
    console.log(`    vinculado a movimiento de Cuentas de socios: ${a.entry_id ? `${a.entry_id} ("${a.entry_concept}")` : "NO -- huérfano, ningún movimiento apunta a este ajuste"}`);
    console.log("");
  }

  console.log("\n######## Saldo Wallet (mismo cálculo que el dashboard) ########\n");
  const saldo = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS'
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS'
     ) t`
  );
  console.log(`Saldo Wallet total (todo, incluye reversiones que se cancelan solas) = ${fmt(Number(saldo.rows[0].neto))}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
