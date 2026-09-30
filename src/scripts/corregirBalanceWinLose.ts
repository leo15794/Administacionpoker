// Corrección histórica (30/09/2026, pedido de Leo, confirmada con el ejemplo real de Tincho:
// "Total a pagar" tiene que dar 227.76 = resultado + rakeback neto): hasta ahora, un cierre
// WIN_LOSE sumaba el cierre completo (resultado de mesas + rakeback + rebate + rodeo + ajuste
// manual) directo al balance de fichas del agente. Con la corrección definitiva (ver
// repo/closings.ts), el cierre nunca mueve el balance -- el monto completo pasa a
// rakeback_pendiente en su lugar. Este script corrige los cierres WIN_LOSE YA aplicados bajo
// la lógica vieja. Es el mismo patrón que separarPendientePrepago.ts, con una sola diferencia
// importante: acá NO se excluye el resultado de mesas -- se mueve el monto COMPLETO (a
// diferencia de PREPAGO, donde el resultado se excluye porque se cuenta aparte como "fichas
// del agente" en Resumen).
//
// Para cada weekly_closing activo con system='WIN_LOSE' que generó un movimiento
// CIERRE_SEMANAL con monto != 0:
//   1. Le resta ese monto al balance (agente, club) -- se saca lo que nunca debió entrar.
//   2. Deja ese mismo movimiento CIERRE_SEMANAL en $0 (no se borra -- se mantiene el rastro,
//      mismo criterio de ledger inmutable de todo este módulo -- solo se corrige el monto y se
//      anota en la observación).
//   3. Ese monto completo (resultado incluido) pasa a rakeback_pendiente (role='AGENTE') de ese
//      cierre -- si ya existía una fila para ese cierre se le suma; si no existía, se crea
//      nueva. Quien tenga que pagarlo hace lo de siempre: Adelantos/Liquidaciones > Pagar en
//      fichas o en USDT.
//
// El rebate desviado a un supervisor (role='SUPERVISOR') NO se toca -- mecanismo aparte, Leo
// no pidió tocarlo acá (mismo alcance que la auditoría en auditoriaCorreccionWinLose.ts).
//
//   - Sin --apply: SOLO IMPRIME qué se va a hacer (agente, club, semana, monto a corregir). No
//     toca la base. Correr esto primero y revisar contra el informe de
//     `npm run auditoria:win-lose` antes de aplicar.
//   - Con --apply: aplica la corrección cierre por cierre, cada uno en su propia transacción
//     (si uno falla, los demás ya aplicados quedan -- revisar el error puntual e investigar ese
//     caso antes de reintentar).
import { pool, newId } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const r = await pool.query(
    `SELECT wc.id as closing_id, wc.agent_id, wc.club_id, wc.week_start, wc.week_end,
            a.name as agent_name, c.name as club_name,
            m.id as mov_id, m.amount as mov_amount
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     JOIN ledger_movements m
       ON m.agent_id = wc.agent_id AND m.club_id = wc.club_id AND m.type = 'CIERRE_SEMANAL'
      AND m.occurred_at::date = wc.week_end::date AND m.status <> 'REVERTIDO'
     WHERE wc.system = 'WIN_LOSE' AND wc.status <> 'REVERTIDO' AND m.amount <> 0
     ORDER BY a.name, c.name, wc.week_start`
  );

  if (r.rows.length === 0) {
    console.log("No hay cierres WIN_LOSE activos con monto distinto de 0 en su movimiento CIERRE_SEMANAL -- nada para corregir (ya corregidos, o no hay ninguno).");
    await pool.end();
    return;
  }

  let total = 0;
  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- ${r.rows.length} cierre(s) WIN_LOSE a corregir (sacar del balance, pasar el monto completo a rakeback pendiente):\n`);

  for (const row of r.rows) {
    const monto = Number(row.mov_amount);
    total += monto;
    console.log(
      `  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)} al ${String(row.week_end).slice(0, 10)}): ${fmt(monto)}`
    );

    if (!APPLY) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Deja el movimiento CIERRE_SEMANAL en $0 (se conserva el rastro, solo se corrige el monto).
      await client.query(
        `UPDATE ledger_movements
         SET amount = 0,
             observation = observation || ' [Corregido 30/09/2026: WIN_LOSE no mueve balance por cierre -- monto completo (' || $2 || ') pasado a rakeback pendiente.]'
         WHERE id = $1`,
        [row.mov_id, monto.toFixed(2)]
      );

      // 2. Saca ese monto del balance (EXCLUDED.amount = -monto en ambos casos, insert o conflict).
      await client.query(
        `INSERT INTO balances (id, agent_id, club_id, amount, updated_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (agent_id, club_id) DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
        [newId("bal"), row.agent_id, row.club_id, -monto]
      );

      // 3. Lo suma (o crea) el rakeback_pendiente role='AGENTE' de ESTE cierre -- monto COMPLETO,
      //    resultado incluido (a diferencia de PREPAGO).
      const existing = await client.query(
        `SELECT * FROM rakeback_pendiente WHERE weekly_closing_id = $1 AND role = 'AGENTE' FOR UPDATE`,
        [row.closing_id]
      );
      if (existing.rows[0]) {
        const p = existing.rows[0];
        const nuevoMonto = Number(p.amount) + monto;
        await client.query(`UPDATE rakeback_pendiente SET amount = $1, active = true, updated_at = now() WHERE id = $2`, [nuevoMonto, p.id]);
        await client.query(
          `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes)
           VALUES ($1,$2,$3,'ALTA',$4,$5,$6,$7)`,
          [
            newId("rpm"),
            p.id,
            row.agent_id,
            monto,
            nuevoMonto,
            Number(p.consumed),
            "Corrección 30/09/2026: WIN_LOSE no mueve balance por cierre -- se agrega el monto completo (resultado incluido) que este cierre había sumado de más al balance.",
          ]
        );
      } else {
        const pendienteId = newId("rp");
        await client.query(
          `INSERT INTO rakeback_pendiente (id, weekly_closing_id, role, agent_id, club_id, amount, consumed, active)
           VALUES ($1,$2,'AGENTE',$3,$4,$5,0,true)`,
          [pendienteId, row.closing_id, row.agent_id, row.club_id, monto]
        );
        await client.query(
          `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes)
           VALUES ($1,$2,$3,'ALTA',$4,$4,0,$5)`,
          [
            newId("rpm"),
            pendienteId,
            row.agent_id,
            monto,
            "Corrección 30/09/2026: WIN_LOSE no mueve balance por cierre -- se pasa a pendiente el monto completo (resultado incluido) que este cierre había sumado al balance.",
          ]
        );
      }

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
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Comparalo contra `npm run auditoria:win-lose` y, si coincide, correr con --apply para aplicar de verdad.");
  } else {
    console.log("\nListo -- aplicado.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
