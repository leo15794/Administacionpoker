// Diagnóstico puntual (22/09/2026): recalcularStockCierres.ts encontró un weekly_closing
// ACTIVO (status APLICADO/CORREGIDO) para cajerouy / Fénix Suprema (semana 2026-09-14 al
// 2026-09-20) cuyo movimiento CIERRE_SEMANAL en el ledger está REVERTIDO -- combinación rara,
// porque normalmente revertir un cierre también marca el weekly_closing como REVERTIDO (ver
// revertirCierreSemanal en repo/closings.ts). Esto imprime todo lo relacionado a ese cierre
// para entender qué pasó antes de decidir qué hacer. Solo lectura, no toca nada.
import { pool } from "../db/pool.js";
import { getAgentByName, getClubByName } from "../repo/catalog.js";

async function main() {
  const agent = await getAgentByName("cajerouy");
  const club = await getClubByName("Fénix Suprema");
  if (!agent || !club) {
    console.log("No se encontró el agente o el club por nombre -- revisar nombres exactos con npm run (o el script listCatalogo).");
    await pool.end();
    return;
  }

  const wcRes = await pool.query(
    `SELECT * FROM weekly_closings WHERE agent_id = $1 AND club_id = $2 ORDER BY week_start`,
    [agent.id, club.id]
  );
  console.log(`── weekly_closings de cajerouy / Fénix Suprema (${wcRes.rows.length}) ──`);
  for (const wc of wcRes.rows) {
    console.log(
      `  id=${wc.id} semana ${wc.week_start} a ${wc.week_end} status=${wc.status} result=${wc.result} rakeback=${wc.rakeback} rebate=${wc.rebate} rodeo=${wc.rodeo} ajuste=${wc.ajuste_manual} final_closing=${wc.final_closing} rule=${wc.rule_applied ?? ""} created_at=${wc.created_at}`
    );
  }

  const movRes = await pool.query(
    `SELECT * FROM ledger_movements WHERE agent_id = $1 AND club_id = $2 AND type IN ('CIERRE_SEMANAL','AJUSTE') ORDER BY occurred_at, id`,
    [agent.id, club.id]
  );
  console.log(`\n── ledger_movements (CIERRE_SEMANAL/AJUSTE) de cajerouy / Fénix Suprema (${movRes.rows.length}) ──`);
  for (const m of movRes.rows) {
    console.log(
      `  id=${m.id} idem=${m.idempotency_key} type=${m.type} status=${m.status} amount=${m.amount} refs=${JSON.stringify(m.refs)} occurred_at=${m.occurred_at} observation="${m.observation}"`
    );
  }

  const balRes = await pool.query(`SELECT * FROM balances WHERE agent_id = $1 AND club_id = $2`, [agent.id, club.id]);
  console.log(`\n── balance actual ──`);
  console.log(balRes.rows[0] ?? "(sin fila de balance)");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
