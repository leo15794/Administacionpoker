// Diagnóstico de arranque: por qué "Adelantos pendientes" muestra un número distinto en la
// ficha del buscador vs. en "Saldos actuales" (Resumen por Agente) para un mismo agente
// (01/10/2026, caso cajerouy -- ficha mostró US$ 1.240,00, Saldos actuales mostró "—").
// 100% de LECTURA, no toca nada.
//
// Hipótesis: la ficha (catalog.ts /agents/:id/cuenta) suma TODOS los adelantos activos sin
// filtrar por "kind", mientras que Saldos actuales (agentesResumen.ts) filtra kind='RAKEBACK'
// a propósito (ver fix de esta sesión) -- un adelanto kind='FICHAS_PENDIENTE' YA está restado
// del balance (balances.amount) en el momento en que se dio (movimiento ADELANTO_FICHAS, ver
// deltaParaBalance en repo/ledger.ts), así que volver a mostrarlo/restarlo como "pendiente"
// aparte sería contarlo dos veces.
//
// Uso: tsx src/scripts/diagnosticoAdelantosAgente.ts "<nombre agente>"
import { pool } from "../db/pool.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const [query] = process.argv.slice(2);
  if (!query) {
    console.log('Uso: tsx src/scripts/diagnosticoAdelantosAgente.ts "<nombre agente>"');
    await pool.end();
    return;
  }

  const ag = await pool.query(`SELECT id, name, default_system FROM agents WHERE name ILIKE $1`, [`%${query}%`]);
  if (ag.rows.length === 0) {
    console.log("No se encontró ningún agente con ese nombre.");
    await pool.end();
    return;
  }
  if (ag.rows.length > 1) {
    console.log(`Encontré ${ag.rows.length} agentes que matchean "${query}" -- tipeá el nombre exacto:`);
    ag.rows.forEach((a) => console.log(`  - ${a.name}`));
    await pool.end();
    return;
  }
  const agent = ag.rows[0];
  console.log(`Agente: ${agent.name} (${agent.id}) -- sistema ${agent.default_system}`);

  const balances = await pool.query(
    `SELECT b.amount, c.name as club_name FROM balances b JOIN clubs c ON c.id = b.club_id WHERE b.agent_id = $1 ORDER BY c.name`,
    [agent.id]
  );
  console.log("\nBalance (balances.amount, lo que ya está en el ledger) por club:");
  let totalBalance = 0;
  for (const b of balances.rows) {
    console.log(`  - ${b.club_name}: ${fmt(Number(b.amount))}`);
    totalBalance += Number(b.amount);
  }
  console.log(`  Total: ${fmt(totalBalance)}`);

  const adelantos = await pool.query(
    `SELECT id, kind, amount, consumed, active, medio, club_origen_id, created_at, notes
     FROM rakeback_advances WHERE agent_id = $1 ORDER BY created_at`,
    [agent.id]
  );
  console.log(`\nTodos los adelantos (rakeback_advances) de este agente (${adelantos.rows.length}):`);
  let totalTodos = 0;
  let totalRakeback = 0;
  let totalFichasPendiente = 0;
  for (const a of adelantos.rows) {
    const pendiente = Number(a.amount) - Number(a.consumed);
    console.log(
      `  - [${a.kind}] amount=${fmt(Number(a.amount))} consumed=${fmt(Number(a.consumed))} pendiente=${fmt(pendiente)} active=${a.active} medio=${a.medio ?? "-"} notes="${a.notes ?? ""}" (${a.created_at.toISOString().slice(0, 10)})`
    );
    if (a.active) {
      totalTodos += pendiente;
      if (a.kind === "RAKEBACK") totalRakeback += pendiente;
      if (a.kind === "FICHAS_PENDIENTE") totalFichasPendiente += pendiente;
    }
  }

  console.log("\n--- Comparación ---");
  console.log(`"Adelantos pendientes" en la FICHA (catalog.ts, sin filtrar kind): ${fmt(totalTodos)}`);
  console.log(`"Adelantos pendientes" en SALDOS ACTUALES (agentesResumen.ts, solo kind=RAKEBACK): ${fmt(totalRakeback)}`);
  console.log(`  (de los cuales kind=FICHAS_PENDIENTE, ya restado del balance arriba: ${fmt(totalFichasPendiente)})`);
  console.log(`\nSaldo real correcto (balance ya neto de FICHAS_PENDIENTE, menos solo lo RAKEBACK pendiente): ${fmt(totalBalance - totalRakeback)}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
