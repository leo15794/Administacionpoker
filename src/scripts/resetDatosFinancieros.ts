// Reset completo de datos financieros/historicos (18/09/2026, pedido de Leo) -- borra TODOS
// los cierres, saldos, movimientos, adelantos y demas datos operativos de TODOS los clubes y
// agentes, para volver a cargar todo a mano desde cero. NO toca la configuracion: clubes,
// agentes, deals agente-club, usuarios, config de bancado, cuentas de socio (las cuentas en
// si, no sus movimientos), referidos de supervisor (la relacion en si, se resetea el saldo a 0).
//
//   - Sin --apply: SOLO IMPRIME cuantas filas tiene cada tabla hoy (lo que se borraria). No
//     toca la base. Correlo primero para confirmar el alcance antes de aplicar nada.
//   - Con --apply --confirmo: borra de verdad. Las dos flags son obligatorias a proposito --
//     esto es irreversible, no hay forma de deshacerlo despues de correrlo.
//
// Tablas que SE BORRAN (TRUNCATE completo):
//   weekly_closings, tiny_rebate_union, club_weekly_extras, balances, ledger_movements,
//   rakeback_advances, rakeback_advance_movements, guarantees, guarantee_movements,
//   treasury_entries, treasury_adjustments, bancado_debts, bancado_historial,
//   rodeo_player_memory, rodeo_agent_memory, audit_snapshots, partner_account_entries,
//   extraordinary_adjustments, extraordinary_adjustment_applications, liquidaciones_guardadas,
//   supervisor_referido_movements, account_stock, profit_periods, profit_period_weeks,
//   carga_pendientes_cruce, carga_cruce_movements, rakeback_pendiente,
//   rakeback_pendiente_movements (estas últimas cuatro se listan explícito para que el reporte
//   muestre sus filas, pero igual se hubieran borrado solas por CASCADE desde ledger_movements/
//   weekly_closings -- 22/09/2026, agregadas al sumar las cargas de tesorería y el rakeback
//   pendiente)
//
// Tablas que se ACTUALIZAN (no se borran, solo se resetea el saldo a 0):
//   supervisor_referidos.saldo
//
// Tablas que NO SE TOCAN (configuracion):
//   clubs, agents, agent_club_deals, rule_versions, players, player_agent_overrides,
//   agent_users, agent_user_agents, bancado_config, partner_accounts, supervisor_referidos
//   (la fila en si, solo se resetea su saldo)
import { pool } from "../db/pool.js";

const APPLY = process.argv.includes("--apply") && process.argv.includes("--confirmo");

// Orden pensado para evitar problemas de FK: primero las tablas "hijas" (movimientos que
// referencian a otra tabla de este mismo grupo), despues las "padre". TRUNCATE de Postgres no
// exige este orden si no hay FKs entre ellas con RESTRICT, pero se deja explicito por claridad.
const TABLAS_A_BORRAR = [
  "guarantee_movements",
  "guarantees",
  "rakeback_advance_movements",
  "rakeback_advances",
  "supervisor_referido_movements",
  "partner_account_entries",
  "extraordinary_adjustment_applications",
  "extraordinary_adjustments",
  "profit_period_weeks",
  "profit_periods",
  "tiny_rebate_union",
  "club_weekly_extras",
  "bancado_historial",
  "bancado_debts",
  "rodeo_player_memory",
  "rodeo_agent_memory",
  "audit_snapshots",
  "liquidaciones_guardadas",
  "account_stock",
  "treasury_adjustments",
  "treasury_entries",
  "ledger_movements",
  "balances",
  "rakeback_pendiente_movements",
  "rakeback_pendiente",
  "carga_cruce_movements",
  "carga_pendientes_cruce",
  "weekly_closings",
];

async function main() {
  console.log(APPLY ? "MODO: APLICAR (esto borra datos de verdad, no se puede deshacer)\n" : "MODO: SOLO REPORTE (no se toca nada)\n");

  let totalFilas = 0;
  for (const tabla of TABLAS_A_BORRAR) {
    const r = await pool.query(`SELECT COUNT(*)::int as n FROM ${tabla}`);
    const n = r.rows[0].n as number;
    totalFilas += n;
    console.log(`  ${tabla.padEnd(38)} ${n} fila(s)`);
  }
  const saldosRef = await pool.query(`SELECT COUNT(*)::int as n FROM supervisor_referidos WHERE saldo <> 0`);
  console.log(`  supervisor_referidos.saldo (a resetear a 0)  ${saldosRef.rows[0].n} fila(s) con saldo distinto de 0`);
  console.log(`\nTotal filas en tablas a borrar: ${totalFilas}`);

  if (!APPLY) {
    console.log("\nNo se borró nada. Para aplicar de verdad: npx tsx src/scripts/resetDatosFinancieros.ts --apply --confirmo");
    return;
  }

  console.log("\nBorrando...");
  await pool.query("BEGIN");
  try {
    for (const tabla of TABLAS_A_BORRAR) {
      await pool.query(`TRUNCATE TABLE ${tabla} RESTART IDENTITY CASCADE`);
    }
    await pool.query(`UPDATE supervisor_referidos SET saldo = 0, updated_at = now() WHERE saldo <> 0`);
    await pool.query("COMMIT");
    console.log("Listo. Se borraron todos los datos financieros/históricos. Clubes, agentes, deals, usuarios y configuración quedaron intactos.");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("Error, se revirtió todo (nada quedó a medio borrar):", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
