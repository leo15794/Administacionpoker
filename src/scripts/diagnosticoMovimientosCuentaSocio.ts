// Diagnóstico de solo lectura: lista TODOS los movimientos (partner_account_entries) de una
// cuenta de socio puntual, con todo el detalle crudo -- para investigar de dónde salió un
// movimiento que nadie recuerda haber cargado a mano (caso 02/10/2026, Fede: -US$1.339,00 sin
// explicación visible). Si idempotency_key empieza con "cierre_persona:" es un movimiento
// AUTOMÁTICO generado por aplicarCierreCompensacionPersonaTx (ver repo/closings.ts) al aplicar
// un cierre semanal de un agente con ese person_key -- no es un error, es el enganche andando.
// Si no tiene idempotency_key, lo cargó alguien a mano desde "+ Movimiento" en Cuentas de socios.
//
// Uso: tsx src/scripts/diagnosticoMovimientosCuentaSocio.ts "<nombre cuenta>"
import { pool } from "../db/pool.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const [nombre] = process.argv.slice(2);
  if (!nombre) {
    console.log('Uso: tsx src/scripts/diagnosticoMovimientosCuentaSocio.ts "<nombre cuenta>"');
    await pool.end();
    return;
  }

  const cuenta = await pool.query(`SELECT * FROM partner_accounts WHERE lower(name) = lower($1)`, [nombre]);
  if (!cuenta.rows[0]) {
    console.log(`No existe ninguna cuenta de socio con nombre "${nombre}".`);
    await pool.end();
    return;
  }
  const c = cuenta.rows[0];
  console.log(`Cuenta "${c.name}" (id=${c.id}, active=${c.active})`);

  const movs = await pool.query(
    `SELECT e.*, a.name as source_agent_name, cl.name as source_club_name
     FROM partner_account_entries e
     LEFT JOIN agents a ON a.id = e.source_agent_id
     LEFT JOIN clubs cl ON cl.id = e.source_club_id
     WHERE e.account_id = $1
     ORDER BY e.created_at`,
    [c.id]
  );

  console.log(`\n${movs.rows.length} movimiento(s):\n`);
  for (const m of movs.rows) {
    console.log(`--- ${m.id} ---`);
    console.log(`  category: ${m.category}`);
    console.log(`  concept: ${m.concept}`);
    console.log(`  amount: ${fmt(Number(m.amount))}`);
    console.log(`  entry_date: ${m.entry_date}`);
    console.log(`  notes: ${m.notes ?? "(ninguna)"}`);
    console.log(`  idempotency_key: ${m.idempotency_key ?? "(ninguna -- cargado a mano)"}`);
    console.log(`  source_agent: ${m.source_agent_name ?? "(ninguno)"} (id=${m.source_agent_id ?? "-"})`);
    console.log(`  source_club: ${m.source_club_name ?? "(ninguno)"}`);
    console.log(`  source_week_start: ${m.source_week_start ?? "(ninguna)"}`);
    console.log(`  created_at: ${m.created_at}`);
    console.log("");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
