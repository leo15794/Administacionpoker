// Migración automática del catch-up histórico para cuentas de socio recién vinculadas
// (caso 02/10/2026: Manos y Fede). A diferencia de diagnosticoSaldoCuentaSocio.ts (que solo
// imprime números para cargar a mano), ESTE script escribe en partner_account_entries usando
// las mismas funciones del repo que usa la UI (crearMovimiento/editarMovimiento), así que
// queda auditado igual que cualquier movimiento cargado desde Cuentas de socios.
//
// Qué hace por cada person_key:
//   1. Busca la cuenta de socio por nombre (tiene que existir ya).
//   2. Suma final_closing de TODOS los cierres (status <> 'REVERTIDO') de los agentes con ese
//      person_key -- esta es la misma cantidad que usa en vivo aplicarCierreCompensacionPersonaTx
//      (amount = -finalClosing) -- EXCLUYENDO cierres que ya se enrutaron automáticamente a una
//      cuenta de socio (routed_to_partner_account_id IS NOT NULL), para no duplicar lo que el
//      enganche automático ya cargó.
//   3. catch-up = -ese total (signo invertido, convención de partner_account_entries: positivo
//      = el socio le debe a la empresa).
//   4. Mira los movimientos MANUALES ya cargados en esa cuenta (idempotency_key IS NULL --
//      los automáticos de cierres reales siempre tienen idempotency_key):
//        - si no hay ninguno: prepara un INSERT nuevo con el catch-up calculado.
//        - si hay exactamente uno: prepara un UPDATE de ese mismo movimiento al monto correcto
//          (conserva el id/concepto, solo corrige el monto -- para el caso Fede, que ya tenía
//          "patoruzito migracion" cargado con el signo invertido).
//        - si ya está en el monto correcto: no hace nada (idempotente, podés re-correr sin miedo).
//        - si hay más de uno: no toca nada y avisa -- hay que resolverlo a mano, es ambiguo.
//
// Por default corre en modo DRY-RUN (solo muestra qué haría). Para aplicar de verdad:
//   tsx src/scripts/migrarSaldoHistoricoSocios.ts manos fede --apply
import { pool } from "../db/pool.js";
import { crearMovimiento, editarMovimiento } from "../repo/partnerAccounts.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const personKeys = args.filter((a) => a !== "--apply").map((s) => s.toLowerCase().trim()).filter(Boolean);

  if (personKeys.length === 0) {
    console.log("Uso: tsx src/scripts/migrarSaldoHistoricoSocios.ts <person_key> [person_key...] [--apply]");
    console.log("Ej:  tsx src/scripts/migrarSaldoHistoricoSocios.ts manos fede          (dry-run, no escribe nada)");
    console.log("Ej:  tsx src/scripts/migrarSaldoHistoricoSocios.ts manos fede --apply  (escribe de verdad)");
    await pool.end();
    return;
  }

  console.log(apply ? "=== MODO APLICAR -- esto va a escribir en la base ===" : "=== MODO DRY-RUN -- no se escribe nada todavía ===");

  for (const personKey of personKeys) {
    console.log(`\n\n######## person_key = "${personKey}" ########`);

    const cuentaRes = await pool.query(`SELECT * FROM partner_accounts WHERE lower(name) = $1`, [personKey]);
    const cuenta = cuentaRes.rows[0];
    if (!cuenta) {
      console.log(`  ATENCIÓN: no existe cuenta de socio "${personKey}" -- creála primero en Cuentas de socios. Salteando.`);
      continue;
    }

    const agentesRes = await pool.query(`SELECT id, name FROM agents WHERE person_key = $1 ORDER BY name`, [personKey]);
    if (agentesRes.rows.length === 0) {
      console.log(`  ATENCIÓN: ningún agente tiene person_key="${personKey}" -- revisá el campo "Cuenta de socio" en Agentes. Salteando.`);
      continue;
    }

    let totalHistorico = 0;
    for (const ag of agentesRes.rows) {
      const h = await pool.query(
        `SELECT COALESCE(SUM(final_closing), 0) as total, COUNT(*)::int as cantidad
         FROM weekly_closings
         WHERE agent_id = $1 AND status <> 'REVERTIDO' AND routed_to_partner_account_id IS NULL`,
        [ag.id]
      );
      const t = Number(h.rows[0].total);
      console.log(`  ${ag.name}: ${h.rows[0].cantidad} cierre(s) sin enrutar, resultado histórico = ${fmt(t)}`);
      totalHistorico += t;
    }
    const catchUp = round2(-totalHistorico);
    console.log(`  Resultado histórico total (todos los agentes) = ${fmt(round2(totalHistorico))}`);
    console.log(`  --> Catch-up correcto para la cuenta de socio = ${fmt(catchUp)}`);

    const manualesRes = await pool.query(
      `SELECT * FROM partner_account_entries WHERE account_id = $1 AND idempotency_key IS NULL ORDER BY created_at`,
      [cuenta.id]
    );
    const manuales = manualesRes.rows;
    console.log(`  Movimientos manuales ya cargados en "${cuenta.name}": ${manuales.length}`);
    for (const m of manuales) {
      console.log(`    - [${m.id}] "${m.concept}" = ${fmt(Number(m.amount))} (${m.entry_date})`);
    }

    if (catchUp === 0) {
      console.log(`  Catch-up calculado es US$ 0,00 -- no hay nada que migrar para "${personKey}".`);
      continue;
    }

    if (manuales.length === 0) {
      console.log(`  PLAN: crear movimiento nuevo con monto ${fmt(catchUp)}.`);
      if (apply) {
        const nuevo = await crearMovimiento({
          accountId: cuenta.id,
          category: "COMPENSACION",
          concept: "Migración histórica (cierres reales pre-vinculación)",
          amount: catchUp,
          notes: `Generado por migrarSaldoHistoricoSocios.ts el ${new Date().toISOString().slice(0, 10)}.`,
        });
        console.log(`  HECHO: creado movimiento [${nuevo.id}] por ${fmt(Number(nuevo.amount))}.`);
      }
    } else if (manuales.length === 1) {
      const m = manuales[0];
      if (round2(Number(m.amount)) === catchUp) {
        console.log(`  El único movimiento manual ya tiene el monto correcto (${fmt(catchUp)}) -- nada que hacer.`);
      } else {
        console.log(`  PLAN: corregir el movimiento [${m.id}] "${m.concept}" de ${fmt(Number(m.amount))} a ${fmt(catchUp)}.`);
        if (apply) {
          const notaVieja = m.notes ? `${m.notes} ` : "";
          const actualizado = await editarMovimiento(m.id, {
            amount: catchUp,
            notes: `${notaVieja}(Monto corregido de ${fmt(Number(m.amount))} a ${fmt(catchUp)} por migrarSaldoHistoricoSocios.ts el ${new Date().toISOString().slice(0, 10)}, usando el histórico real de cierres.)`,
          });
          console.log(`  HECHO: movimiento [${actualizado.id}] ahora en ${fmt(Number(actualizado.amount))}.`);
        }
      }
    } else {
      console.log(`  ATENCIÓN: hay ${manuales.length} movimientos manuales -- es ambiguo cuál corregir, no toco nada. Resolvelo a mano en Cuentas de socios.`);
    }
  }

  console.log(apply ? "\n=== Listo. Revisá el saldo en Cuentas de socios. ===" : "\n=== Dry-run terminado. Si está todo bien, volvé a correr con --apply. ===");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
