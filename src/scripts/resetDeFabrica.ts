// "Reset de fábrica" (24/09/2026, pedido de Leo): borrar TODA la información de números/cierres
// (ledger, balances, cierres, pendientes, garantías consumidas, proveedores, socios, etc.) sin
// tocar NADA de la configuración de agentes/clubes/deals/usuarios. Pedido porque el sistema
// todavía no está en uso real: "no pasa nada porque todavia no lo estamos usando, a lo sumo
// volvemos a cargar la info" -- no hace falta backup.
//
// CONFIG que se preserva intacta (nunca se toca): clubs, agents, agent_club_deals,
// rule_versions, players, player_agent_overrides, bancado_config, agent_users,
// agent_user_agents, partner_accounts, proveedores, proveedor_auto_cierre_clubes.
//
// Tablas de "números" que se BORRAN ENTERAS (orden que respeta todas las foreign keys):
//   weekly_closing_player_details, rakeback_pendiente_movements, rakeback_pendiente,
//   supervisor_referido_movements, rakeback_advance_movements, rakeback_advances,
//   carga_cruce_movements, carga_pendientes_cruce, guarantee_movements,
//   proveedor_garantia_movements, proveedor_cierre_lineas, proveedor_cierres,
//   proveedor_pagos, proveedor_saldos, treasury_entries, treasury_adjustments,
//   partner_account_entries, extraordinary_adjustment_applications, profit_period_weeks,
//   extraordinary_adjustments, profit_periods, weekly_closings, ledger_movements,
//   bancado_debts, bancado_historial, rodeo_player_memory, rodeo_agent_memory, balances,
//   account_stock, club_weekly_extras, liquidaciones_guardadas, tiny_rebate_union,
//   audit_snapshots.
//
// Tablas mixtas (config + número) que se dejan EN CERO pero la fila NO se borra -- confirmado
// por Leo vía AskUserQuestion (24/09/2026):
//   - guarantees: amount=0, consumed=0 (se mantiene active/notes -- sigue configurado qué
//     agentes tienen garantía).
//   - supervisor_referidos: saldo=0 (se mantiene porcentaje/active -- sigue configurada la
//     relación supervisor<->referido).
//   - proveedor_garantias: mismo criterio que guarantees por analogía directa (estructura
//     idéntica: amount/consumed/active/notes) -- Leo no la mencionó explícitamente, avisar si
//     no es lo que quiere.
//
//   - Sin --apply: SOLO IMPRIME cuántas filas tiene cada tabla hoy (lo que se borraría/
//     pondría en cero). No toca la base.
//   - Con --apply: hace TODO en una sola transacción (o se aplica entero, o no se aplica nada).
import { pool } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");

// Orden de borrado: respeta cada foreign key (una tabla nunca aparece antes que algo que
// todavía le apunta).
const TABLAS_A_BORRAR_ENTERAS = [
  "weekly_closing_player_details",
  "rakeback_pendiente_movements",
  "rakeback_pendiente",
  "supervisor_referido_movements",
  "rakeback_advance_movements",
  "rakeback_advances",
  "carga_cruce_movements",
  "carga_pendientes_cruce",
  "guarantee_movements",
  "proveedor_garantia_movements",
  "proveedor_cierre_lineas",
  "proveedor_cierres",
  "proveedor_pagos",
  "proveedor_saldos",
  "treasury_entries",
  "treasury_adjustments",
  "partner_account_entries",
  "extraordinary_adjustment_applications",
  "profit_period_weeks",
  "extraordinary_adjustments",
  "profit_periods",
  "weekly_closings",
  "ledger_movements",
  "bancado_debts",
  "bancado_historial",
  "rodeo_player_memory",
  "rodeo_agent_memory",
  "balances",
  "account_stock",
  "club_weekly_extras",
  "liquidaciones_guardadas",
  "tiny_rebate_union",
  "audit_snapshots",
];

// Tablas mixtas: se dejan en cero, la fila (y su config) queda.
const TABLAS_A_PONER_EN_CERO: { tabla: string; sql: string }[] = [
  { tabla: "guarantees", sql: `UPDATE guarantees SET amount = 0, consumed = 0, updated_at = now()` },
  { tabla: "supervisor_referidos", sql: `UPDATE supervisor_referidos SET saldo = 0, updated_at = now()` },
  { tabla: "proveedor_garantias", sql: `UPDATE proveedor_garantias SET amount = 0, consumed = 0, updated_at = now()` },
];

async function contar(tabla: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`);
  return r.rows[0].n;
}

async function main() {
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- reset de fábrica (borra números/cierres, preserva config de agentes/clubes)\n`);

  console.log("Se van a BORRAR ENTERAS estas tablas:");
  let totalFilasABorrar = 0;
  for (const tabla of TABLAS_A_BORRAR_ENTERAS) {
    const n = await contar(tabla);
    totalFilasABorrar += n;
    console.log(`  ${tabla}: ${n} fila(s)`);
  }

  console.log("\nSe van a dejar EN CERO (fila y config se mantienen) estas tablas:");
  for (const { tabla } of TABLAS_A_PONER_EN_CERO) {
    const n = await contar(tabla);
    console.log(`  ${tabla}: ${n} fila(s) a poner en amount/consumed/saldo = 0`);
  }

  console.log(`\nTotal de filas a borrar: ${totalFilasABorrar}`);

  console.log("\nEstas tablas de CONFIG NO se tocan: clubs, agents, agent_club_deals, rule_versions, players, player_agent_overrides, bancado_config, agent_users, agent_user_agents, partner_accounts, proveedores, proveedor_auto_cierre_clubes.");

  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Correr con --apply para aplicar de verdad.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const tabla of TABLAS_A_BORRAR_ENTERAS) {
      await client.query(`DELETE FROM ${tabla}`);
    }
    for (const { sql } of TABLAS_A_PONER_EN_CERO) {
      await client.query(sql);
    }

    await client.query("COMMIT");
    console.log("\nListo -- reset de fábrica aplicado. Toda la config de agentes/clubes/deals/usuarios quedó intacta.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nERROR -- se hizo ROLLBACK, no se aplicó nada.");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
