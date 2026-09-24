// Corrección (24/09/2026, Leo viendo un cierre real -- TB prodigio25, -US$1.041,64
// "Descuento de fichas por pago de rakeback pendiente en USDT"): la regla de ese mismo día que
// restaba fichas a un agente PREPAGO cuando se le pagaba el rakeback pendiente en plata real
// (USDT/EFECTIVO/ZELLE) quedó REVERTIDA -- Leo: "esas fichas no deberian descontarse de su
// saldo, porque es pago de rakeback" / "solamente se transforma en fichas cuando le cargamos
// fichas". repo/rakebackPendiente.ts ya se corrigió para que los pagos NUEVOS no generen más
// esa DESCARGA -- este script revierte las DESCARGA que ya se generaron por esa regla mientras
// estuvo activa (24/09/2026).
//
// Busca movimientos tipo DESCARGA, status APLICADO, con la observación exacta que generaba
// pagarPendiente() para este caso ("Descuento de fichas por pago de rakeback pendiente en
// USDT/EFECTIVO/ZELLE (agente PREPAGO).") y llama a revertirMovimiento() de repo/ledger.ts para
// cada una -- el ledger es inmutable: nunca se borra el original, se genera un AJUSTE reverso
// (que le devuelve las fichas al agente) y el original queda marcado REVERTIDO.
//
//   - Sin --apply: SOLO IMPRIME qué se va a revertir. No toca la base.
//   - Con --apply: revierte fila por fila, cada una en su propia transacción (revertirMovimiento
//     ya maneja su propia transacción).
import { pool } from "../db/pool.js";
import { revertirMovimiento } from "../repo/ledger.js";

const APPLY = process.argv.includes("--apply");

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const r = await pool.query(
    `SELECT lm.id, lm.amount, lm.occurred_at, lm.observation, a.name as agent_name, c.name as club_name
     FROM ledger_movements lm
     JOIN agents a ON a.id = lm.agent_id
     JOIN clubs c ON c.id = lm.club_id
     WHERE lm.type = 'DESCARGA'
       AND lm.status = 'APLICADO'
       AND lm.observation ~ '^Descuento de fichas por pago de rakeback pendiente en (USDT|EFECTIVO|ZELLE) \\(agente PREPAGO\\)\\.$'
     ORDER BY lm.occurred_at`
  );

  if (r.rows.length === 0) {
    console.log("No hay descargas de fichas por pago de rakeback pendiente PREPAGO para revertir.");
    await pool.end();
    return;
  }

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- revertir descuentos de fichas por pago de rakeback pendiente en plata real (agente PREPAGO).\n`);
  console.log(`A REVERTIR (${r.rows.length}):`);
  for (const row of r.rows) {
    console.log(
      `  ${row.agent_name} — ${row.club_name} (${String(row.occurred_at).slice(0, 10)}): ${fmt(-Number(row.amount))} -- se le devuelven esas fichas. [${row.id}]`
    );
  }

  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Correr con --apply para aplicar de verdad.");
    await pool.end();
    return;
  }

  let ok = 0;
  for (const row of r.rows) {
    const res = await revertirMovimiento(
      row.id,
      "Corrección 24/09/2026: pagar el rakeback pendiente de un PREPAGO en plata real no tiene que descontar fichas -- esa regla quedó revertida el mismo día."
    );
    if (res.found) ok++;
  }

  console.log(`\nListo -- ${ok} movimiento(s) revertido(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
