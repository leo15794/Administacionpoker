// Corrección histórica (24/09/2026, pedido de Leo): revierte, para los cierres YA aplicados
// entre el 22/09/2026 y hoy, la separación balance/rakeback pendiente introducida ese día --
// Leo confirmó que el Saldo tiene que ser el cierre económico completo (fichas + rakeback/
// rebate/Rodeo), no solo la parte de mesas, y que este mismo criterio se revierte también hacia
// adelante en repo/closings.ts (aplicarCierreSemanal). Este script junta de vuelta al Saldo
// cada rakeback_pendiente con role='AGENTE' que todavía tenga monto sin pagar, usando el mismo
// mecanismo real de "Pagar en fichas" (pagarPendiente medio=FICHAS, ver
// repo/rakebackPendiente.ts) -- así queda con su propio rastro de auditoría (movimiento CARGA +
// registro PAGO_FICHAS) en vez de tocar `balances` a mano por afuera del sistema.
//
// El rebate desviado a un supervisor (role='SUPERVISOR') NO se toca -- ese mecanismo (rebate_
// destino='RAKEBACK_SUPERVISOR') sigue vigente tal cual, Leo no pidió revertir eso.
//
//   - Sin --apply: SOLO IMPRIME qué se va a hacer (agente, club, semana, monto pendiente). No
//     toca la base.
//   - Con --apply: paga cada fila en fichas, una por una (mismo camino que un admin usando
//     "Adelantos > Pagar en fichas" a mano, así que respeta lo que ya se haya pagado
//     parcialmente -- solo mueve el restante).
import { pool } from "../db/pool.js";
import { pagarPendiente } from "../repo/rakebackPendiente.js";

const APPLY = process.argv.includes("--apply");

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  // BUG encontrado el 24/09/2026 (Leo lo detectó en tb prodigio25): esta consulta NO filtraba
  // por wc.system -- corrió una vez sin ese filtro y pagó en fichas también el rakeback
  // pendiente de agentes PREPAGO, justo lo contrario de la regla nueva para PREPAGO (ver
  // repo/closings.ts). Se agrega el filtro system='WIN_LOSE' acá para que esto no se repita. El
  // daño ya hecho se corrige con revertirFusionErroneaPrepago.ts.
  const r = await pool.query(
    `SELECT rp.id, rp.amount, rp.consumed, a.name as agent_name, c.name as club_name,
            wc.week_start, wc.week_end
     FROM rakeback_pendiente rp
     JOIN agents a ON a.id = rp.agent_id
     JOIN clubs c ON c.id = rp.club_id
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     WHERE rp.active = true AND rp.role = 'AGENTE' AND rp.amount > rp.consumed AND wc.system = 'WIN_LOSE'
     ORDER BY a.name, c.name, wc.week_start`
  );

  if (r.rows.length === 0) {
    console.log("No hay rakeback pendiente de agentes (role AGENTE) sin pagar -- nada para corregir.");
    await pool.end();
    return;
  }

  let total = 0;
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- ${r.rows.length} fila(s) de rakeback pendiente (role AGENTE) a fusionar con el Saldo:\n`);
  for (const row of r.rows) {
    const restante = Number(row.amount) - Number(row.consumed);
    total += restante;
    console.log(`  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)} al ${String(row.week_end).slice(0, 10)}): ${fmt(restante)}`);
    if (APPLY) {
      await pagarPendiente({
        pendienteId: row.id,
        amount: restante,
        medio: "FICHAS",
        notes: "Corrección 24/09/2026: se revierte la separación balance/rakeback pendiente para agentes Win/Lose (pedido de Leo) -- se une de nuevo al Saldo.",
      });
    }
  }
  console.log(`\nTotal: ${fmt(total)}`);
  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Correr con --apply para aplicar de verdad.");
  } else {
    console.log("\nListo -- aplicado.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
