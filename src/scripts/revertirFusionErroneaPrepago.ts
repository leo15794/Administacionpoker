// Corrección de dos bugs distintos que terminaron en lo mismo (24/09/2026): un agente PREPAGO
// SOLO tiene que tener fichas por lo que paga por adelantado (ver repo/closings.ts) -- pagarle
// su rakeback pendiente EN FICHAS (medio=FICHAS) rompe esa regla, y sin embargo pasó por dos
// caminos distintos: (1) fusionarPendienteAgenteASaldo.ts (el script de corrección Win/Lose) no
// filtraba por wc.system, y (2) el formulario de "Pago" en Liquidaciones arrancaba tildado en
// "FICHAS" para CUALQUIER agente con rakeback pendiente, sin distinguir el sistema. Leo lo
// detectó en tb prodigio25 (US$1.343,69) y yAtt0r0 (US$413,00). Los dos caminos ya están
// tapados (fusionarPendienteAgenteASaldo.ts filtra WIN_LOSE, Liquidaciones ya no ofrece/tilda
// FICHAS para PREPAGO, y pagarPendiente lo rechaza del lado del servidor si igual se intenta).
//
// Este script busca CUALQUIER pago en fichas (rakeback_pendiente_movements tipo PAGO_FICHAS)
// hecho sobre el rakeback pendiente de un agente de un weekly_closing system='PREPAGO' -- no
// importa por qué camino se hizo -- y los deshace:
//   1. Revierte el movimiento de ledger (CARGA) que se había generado -- resta esas fichas del
//      balance (mismo mecanismo de "Revertir" de todo el ledger, deja rastro, no borra nada).
//   2. Le resta ese monto a rakeback_pendiente.consumed -- vuelve a quedar pendiente de pago de
//      verdad, para pagarse ahora por el medio correcto (fichas si corresponde, o USDT/efectivo/
//      zelle sin tocar el balance).
//
//   - Sin --apply: SOLO IMPRIME qué se va a deshacer. No toca la base.
//   - Con --apply: deshace cada pago erróneo, cada uno en su propia transacción.
import { pool, newId } from "../db/pool.js";
import { revertirMovimiento } from "../repo/ledger.js";

const APPLY = process.argv.includes("--apply");

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const r = await pool.query(
    `SELECT rpm.id as rpm_id, rpm.amount, rpm.movement_id, rp.id as pendiente_id, rp.consumed,
            a.name as agent_name, c.name as club_name, wc.week_start, wc.week_end,
            m.status as mov_status
     FROM rakeback_pendiente_movements rpm
     JOIN rakeback_pendiente rp ON rp.id = rpm.pendiente_id
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     JOIN agents a ON a.id = rp.agent_id
     JOIN clubs c ON c.id = rp.club_id
     LEFT JOIN ledger_movements m ON m.id = rpm.movement_id
     WHERE rpm.type = 'PAGO_FICHAS' AND wc.system = 'PREPAGO'
     ORDER BY a.name, c.name, wc.week_start`
  );

  if (r.rows.length === 0) {
    console.log("No se encontraron pagos en fichas sobre rakeback pendiente de agentes PREPAGO -- nada para corregir.");
    await pool.end();
    return;
  }

  let total = 0;
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- ${r.rows.length} pago(s) erróneo(s) en fichas a deshacer (agentes PREPAGO):\n`);

  for (const row of r.rows) {
    const monto = Number(row.amount);
    total += monto;
    const yaRevertido = row.mov_status === "REVERTIDO";
    console.log(
      `  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)} al ${String(row.week_end).slice(0, 10)}): ${fmt(monto)}` +
        (yaRevertido ? "  [movimiento de ledger YA estaba revertido -- solo se corrige el pendiente]" : "") +
        (!row.movement_id ? "  [sin movement_id -- no se encontró el movimiento de ledger, revisar a mano]" : "")
    );

    if (!APPLY) continue;

    // 1. Revierte el movimiento de ledger (si existe y no estaba ya revertido) -- esto ya
    // resta las fichas del balance con el mecanismo estándar. revertirMovimiento administra su
    // propia transacción (su propia conexión del pool), separada de la de abajo.
    if (row.movement_id && !yaRevertido) {
      await revertirMovimiento(
        row.movement_id,
        "Corrección 24/09/2026: pago erróneo de rakeback pendiente en fichas para agente PREPAGO -- un PREPAGO solo tiene fichas por lo que paga por adelantado."
      );
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 2. Vuelve a dejar pendiente ese monto (resta de consumed).
      const nuevoConsumed = Math.max(0, Number(row.consumed) - monto);
      await client.query(`UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2`, [nuevoConsumed, row.pendiente_id]);
      await client.query(
        `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes)
         SELECT $1, $2, agent_id, 'ALTA', $3, amount, $4, $5 FROM rakeback_pendiente WHERE id = $2`,
        [
          newId("rpm"),
          row.pendiente_id,
          monto,
          nuevoConsumed,
          "Corrección 24/09/2026: se deshace el pago erróneo en fichas -- vuelve a quedar pendiente de pago real (USDT/efectivo/Zelle).",
        ]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`\nTotal corregido: ${fmt(total)}`);
  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Correr con --apply para aplicar de verdad.");
  } else {
    console.log("\nListo -- aplicado. El rakeback pendiente vuelve a estar disponible para pagarse por el medio correcto.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
