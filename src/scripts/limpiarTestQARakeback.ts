// Limpieza puntual (22/09/2026): el primer corrida de testRakebackPendienteFlujo.ts se cortó a
// mitad de su propia limpieza (bug de orden de borrado, ya arreglado -- ver ese archivo), y
// dejó restos del agente/club de prueba TEST-QA-* en la base real. Este script los borra sin
// depender de que el test se pueda seguir ejecutando de nuevo. Idempotente: si no encuentra
// nada, no hace nada.
import { pool } from "../db/pool.js";
import { getAgentByName, getClubByName } from "../repo/catalog.js";

async function main() {
  const agent = await getAgentByName("TEST-QA-RakebackAgente");
  const club = await getClubByName("TEST-QA-RakebackClub");

  if (!agent && !club) {
    console.log("No queda nada de TEST-QA-RakebackAgente / TEST-QA-RakebackClub -- nada que limpiar.");
    await pool.end();
    return;
  }

  const agentId = agent?.id;
  const clubId = club?.id;
  console.log(`Encontrado: agente=${agentId ?? "(no existe)"} club=${clubId ?? "(no existe)"}`);

  if (agentId) {
    await pool.query(`DELETE FROM rakeback_pendiente_movements WHERE agent_id = $1`, [agentId]);
    await pool.query(`DELETE FROM rakeback_pendiente WHERE agent_id = $1`, [agentId]);
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
  }
  if (clubId) {
    await pool.query(`DELETE FROM clubs WHERE id = $1`, [clubId]);
  }

  console.log("Listo -- se borró todo rastro de la corrida de prueba anterior.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
