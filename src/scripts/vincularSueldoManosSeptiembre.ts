// Vincula el sueldo de Manos que ya se había cargado a mano con su período (03/11/2026, pedido de
// Leo al implementar el sueldo automático, ver repo/sueldoManos.ts). Leo confirmó que los 1.000
// cargados el 08/10 son el sueldo de Septiembre 2026, ya pagado:
//   - "Sueldo Manos" -900 en la cuenta de Juan (estaba como AJUSTE, así que restaba de la ganancia
//     de octubre): pasa a PAGO y queda como el movimiento del pago.
//   - "Resto de sueldo Manos" -100 en la cuenta de Manos: no se toca, queda anotado.
// Crea el sueldo de septiembre como PAGADO por 1.000 (cargado a mano, antes de la regla del 10%),
// sin volver a bajar la deuda de Juan. Busca también cualquier otro movimiento "sueldo" y lo
// informa si no lo puede relacionar.
// Uso: npx tsx src/scripts/vincularSueldoManosSeptiembre.ts [--aplicar]
import "dotenv/config";
import { pool, newId } from "../db/pool.js";
import { asegurarTablaSueldosManos } from "../repo/sueldoManos.js";

const APLICAR = process.argv.includes("--aplicar");
const PERIODO = "Septiembre 2026";
const SUELDO = 1000;

async function main() {
  const otros = await pool.query(
    `SELECT e.id, a.name AS cuenta, e.category, e.concept, e.amount, e.entry_date::date::text AS fecha
     FROM partner_account_entries e JOIN partner_accounts a ON a.id = e.account_id
     WHERE e.concept ILIKE '%sueldo%' ORDER BY e.entry_date`
  );
  console.log("Movimientos con 'sueldo' en el concepto:");
  for (const m of otros.rows) console.log(`  ${m.fecha}  ${m.cuenta.padEnd(10)} ${m.category.padEnd(12)} ${Number(m.amount).toFixed(2).padStart(9)}  ${m.concept}  (${m.id})`);

  const per = await pool.query(`SELECT * FROM profit_periods WHERE name = $1`, [PERIODO]);
  const periodo = per.rows[0];
  if (!periodo) throw new Error(`No existe el período ${PERIODO}.`);
  if (periodo.status !== "CERRADO") throw new Error(`${PERIODO} no está cerrado.`);

  await asegurarTablaSueldosManos();
  const ya = await pool.query(`SELECT * FROM manos_sueldos WHERE period_id = $1`, [periodo.id]);
  if (ya.rows[0]) {
    console.log(`\n${PERIODO} ya tiene sueldo (${ya.rows[0].estado}, US$ ${Number(ya.rows[0].sueldo_usdt).toFixed(2)}). Nada que hacer.`);
    return;
  }

  const juan = otros.rows.filter((m) => m.cuenta === "Juan" && /^sueldo manos$/i.test(m.concept.trim()) && Number(m.amount) === -900);
  const manos = otros.rows.filter((m) => m.cuenta === "Manos" && /resto de sueldo manos/i.test(m.concept) && Number(m.amount) === -100);
  if (juan.length !== 1) throw new Error(`Esperaba un único "Sueldo Manos" de -900 en la cuenta de Juan y hay ${juan.length}: no se puede vincular sin ambigüedad.`);
  const movJuan = juan[0];
  const base = Number(periodo.ganancia_neta_final);
  const disponible = Math.round((base - SUELDO) * 100) / 100;

  console.log(`\n${PERIODO} (${periodo.id}): ganancia neta final ${base.toFixed(2)}`);
  console.log(`  Sueldo PAGADO US$ ${SUELDO.toFixed(2)} (cargado a mano) → ganancia disponible para socios ${disponible.toFixed(2)}`);
  console.log(`  "${movJuan.concept}" ${movJuan.fecha} -900 en Juan: ${movJuan.category} → PAGO, queda como el pago del sueldo (no se vuelve a bajar la deuda)`);
  console.log(manos.length === 1 ? `  "Resto de sueldo Manos" -100 en Manos (${manos[0].id}): no se toca, queda anotado` : `  No encontré el "Resto de sueldo Manos" de -100 en la cuenta de Manos`);
  const sinRelacionar = otros.rows.filter((m) => m.id !== movJuan.id && !manos.some((x) => x.id === m.id));
  if (sinRelacionar.length) console.log(`  Sin relacionar automáticamente: ${sinRelacionar.map((m) => `${m.concept} (${m.cuenta}, ${m.fecha})`).join("; ")}`);

  if (!APLICAR) {
    console.log("\nSimulación: no se guardó nada. Correr con --aplicar para aplicarlo.");
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE partner_account_entries SET category = 'PAGO',
         idempotency_key = COALESCE(idempotency_key, $2),
         notes = CONCAT_WS(' ', notes, $3::text), updated_at = now()
       WHERE id = $1`,
      [
        movJuan.id,
        `SUELDO_MANOS_PAGO-${periodo.id}`,
        `Sueldo de Manos de ${PERIODO} (pagado por Juan; reduce su deuda y no mueve Wallet Manos). Antes estaba como ${movJuan.category}.`,
      ]
    );
    await client.query(
      `INSERT INTO manos_sueldos (id, period_id, period_name, generado_at, base_calculo_usdt, porcentaje, minimo_usdt, sueldo_usdt,
         ganancia_disponible_socios, regla_manual, estado, fecha_pago, equivalente_usdt, cuenta_pagadora, movimiento_cuenta_juan_id,
         idempotency_key, observaciones)
       VALUES ($1,$2,$3,$4,$5,0.1,400,$6,$7,TRUE,'PAGADO',$8,$6,$9,$10,$11,$12)`,
      [
        newId("sueldo"),
        periodo.id,
        PERIODO,
        periodo.closed_at,
        base,
        SUELDO,
        disponible,
        movJuan.fecha,
        "juan",
        movJuan.id,
        `SUELDO_MANOS-${periodo.id}`,
        `Migrado el ${new Date().toISOString().slice(0, 10)}: sueldo cargado a mano antes de la regla automática. 900 pagados por Juan ("Sueldo Manos", ${movJuan.fecha})` +
          (manos.length === 1 ? ` y 100 en la cuenta de Manos ("Resto de sueldo Manos", ${manos[0].fecha}, no vinculado).` : "."),
      ]
    );
    await client.query("COMMIT");
    console.log("\nAplicado.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
