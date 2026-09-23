// Corrección de un bug mío (24/09/2026): fusionarPendienteAgenteASaldo.ts (el script de
// corrección histórica para agentes WIN_LOSE) no filtraba por wc.system -- si se corrió, pagó
// en fichas (medio FICHAS) también el rakeback pendiente de agentes PREPAGO, justo lo contrario
// de la regla nueva para PREPAGO (ver repo/closings.ts: un PREPAGO solo tiene fichas por cargas
// manuales/adelantos, nunca por el cierre ni por pagar su rakeback pendiente). Leo lo detectó en
// tb prodigio25.
//
// Este script busca esos pagos erróneos (rakeback_pendiente_movements tipo PAGO_FICHAS, con la
// nota de texto que generó fusionarPendienteAgenteASaldo.ts, para pendientes de un weekly_closing
// system='PREPAGO') y los deshace:
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
const NOTA_BUGGEADA = "se revierte la separación balance/rakeback pendiente para agentes Win/Lose";

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
     WHERE rpm.type = 'PAGO_FICHAS' AND rpm.notes LIKE '%' || $1 || '%' AND wc.system = 'PREPAGO'
     ORDER BY a.name, c.name, wc.week_start`,
    [NOTA_BUGGEADA]
  );

  if (r.rows.length === 0) {
    console.log("No se encontraron pagos erróneos de rakeback pendiente PREPAGO por el bug del 24/09/2026 -- nada para corregir.");
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
        "Corrección 24/09/2026: pago erróneo de rakeback pendiente en fichas para agente PREPAGO (bug de fusionarPendienteAgenteASaldo.ts sin filtro de sistema)."
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
          "Corrección 24/09/2026: se deshace el pago erróneo en fichas (bug del script de corrección Win/Lose) -- vuelve a quedar pendiente de pago real.",
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
