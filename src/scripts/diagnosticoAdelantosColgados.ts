// Diagnóstico de SOLO LECTURA (02/10/2026, caso TB prodigio25): busca en TODO el sistema
// adelantos de rakeback que quedaron "colgados" -- activos en rakeback_advances pero cuyo
// movimiento de ledger de origen (alta/aumento/consumo, vía rakeback_advance_movements) ya fue
// REVERTIDO en Movimientos. Antes del fix en repo/ledger.ts (revertirMovimiento), "Revertir" no
// tenía ninguna noción de esta tabla, así que cada vez que se revertía una Carga/Descarga ligada
// a un adelanto, el adelanto se quedaba activo igual, inflando "Adelantos pendientes" de más.
// Este script NO modifica nada -- solo lista los casos para decidir qué hacer con cada uno.
import { pool } from "../db/pool.js";

async function main() {
  const r = await pool.query(
    `SELECT ra.id as advance_id, ag.name as agent_name, ra.amount, ra.consumed,
            ra.kind, ra.medio, ra.notes as advance_notes, ra.updated_at,
            ram.type as adv_mov_type, ram.amount as adv_mov_amount, ram.occurred_at as adv_mov_fecha,
            lm.id as movement_id, lm.observation as ledger_obs
     FROM rakeback_advances ra
     JOIN agents ag ON ag.id = ra.agent_id
     JOIN rakeback_advance_movements ram ON ram.advance_id = ra.id
     JOIN ledger_movements lm ON lm.id = ram.movement_id
     WHERE ra.active = true AND lm.status = 'REVERTIDO'
     ORDER BY ag.name, ra.id, ram.occurred_at`
  );

  if (r.rows.length === 0) {
    console.log("No se encontró ningún adelanto colgado -- todo prolijo.");
  } else {
    console.log(`Encontrados ${r.rows.length} movimiento(s) de adelanto ligado(s) a un ledger_movement revertido:\n`);
    for (const row of r.rows) {
      const pendiente = Number(row.amount) - Number(row.consumed);
      console.log(`agente="${row.agent_name}"  adelanto=${row.advance_id}  (${row.kind}, medio=${row.medio ?? "-"})`);
      console.log(`  adelanto actual: amount=${row.amount}  consumed=${row.consumed}  pendiente=${pendiente.toFixed(2)}  notas="${row.advance_notes ?? "-"}"`);
      console.log(`  movimiento ligado revertido: tipo=${row.adv_mov_type}  monto=${row.adv_mov_amount}  fecha=${new Date(row.adv_mov_fecha).toISOString().slice(0,10)}  ledger_movement=${row.movement_id}`);
      console.log(`  observación del ledger: ${row.ledger_obs ?? "-"}\n`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
