// Corrección (02/10/2026, caso TB prodigio25 + cajerouy, detectados por
// diagnosticoAdelantosColgados.ts): da de BAJA cada adelanto de rakeback que quedó activo con su
// movimiento de ledger de origen ya REVERTIDO -- reusa ajustarAdelanto (repo/advances.ts) con
// type="BAJA", exactamente lo mismo que hace el botón "Ajustar -> Baja" en la pantalla de
// Adelantos, así queda el mismo registro en el historial (tipo BAJA) que si lo hubieras
// apretado vos a mano. No toca el ledger (BAJA nunca genera movimiento), así que no choca con
// que el movimiento original ya esté revertido.
//
// Vuelve a correr la MISMA query del diagnóstico antes de tocar nada (por si entre que corriste
// uno y el otro cambió algo) y solo actúa sobre lo que encuentra en ese momento -- no hardcodea
// los ids de los dos casos ya detectados, para que sirva también si aparece alguno más adelante.
import { pool } from "../db/pool.js";
import { ajustarAdelanto } from "../repo/advances.js";

async function main() {
  const r = await pool.query(
    `SELECT DISTINCT ra.id as advance_id, ag.name as agent_name, ra.amount, ra.consumed
     FROM rakeback_advances ra
     JOIN agents ag ON ag.id = ra.agent_id
     JOIN rakeback_advance_movements ram ON ram.advance_id = ra.id
     JOIN ledger_movements lm ON lm.id = ram.movement_id
     WHERE ra.active = true AND lm.status = 'REVERTIDO'
     ORDER BY ag.name`
  );

  if (r.rows.length === 0) {
    console.log("No hay nada para corregir -- no se encontró ningún adelanto colgado.");
    await pool.end();
    return;
  }

  console.log(`Dando de baja ${r.rows.length} adelanto(s) colgado(s):\n`);
  for (const row of r.rows) {
    const pendiente = Number(row.amount) - Number(row.consumed);
    await ajustarAdelanto({
      advanceId: row.advance_id,
      type: "BAJA",
      amount: 0,
      notes: "Baja automática (corregirAdelantosColgados.ts, 02/10/2026): el movimiento de ledger que le dio origen fue revertido desde Movimientos y el adelanto había quedado activo sin que nada lo reflejara.",
      createdBy: "script:corregirAdelantosColgados",
    });
    console.log(`  OK -- agente="${row.agent_name}"  adelanto=${row.advance_id}  (pendiente que tenía: ${pendiente.toFixed(2)}) -- dado de baja.`);
  }

  console.log("\nListo. Volvé a correr diagnosticoAdelantosColgados.ts para confirmar que no queda ninguno.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
