// Corrección (24/09/2026, aclaración de Leo sobre Liquidaciones: "en pendiente de rakeback,
// debería ser el mismo que rakeback neto"): el "Rakeback pendiente" de un cierre PREPAGO venía
// incluyendo el resultado de mesas (ej. TB prodigio25: pendiente 3.161,03 = 1.619,38 de mesas +
// 1.541,65 de rakeback neto) -- Leo confirmó que el resultado de mesas NO tiene que generar
// ningún pendiente de pago, solo queda como referencia (columna "Fichas ganadas en mesas" en
// Resumen). repo/closings.ts ya se corrigió para que los cierres NUEVOS no incluyan el
// resultado de mesas en el pendiente -- este script corrige los cierres PREPAGO YA aplicados.
//
// Para cada rakeback_pendiente activo (role='AGENTE') de un weekly_closing PREPAGO activo:
//   esperadoViejo = rakeback + (rebate si NO se desvió a supervisor) + rodeo + ajuste_manual + result
//   esperadoNuevo = esperadoViejo - result
//
//   - Si el monto actual del pendiente ≈ esperadoViejo (con el resultado de mesas adentro,
//     como generaba el motor viejo): se corrige a esperadoNuevo.
//   - Si el monto actual ya ≈ esperadoNuevo (ya corregido, ej. cierres nuevos post-fix): se
//     deja como está (evita corregir dos veces si el script se corre más de una vez).
//   - Si no coincide con ninguno de los dos (algo raro, ej. ya se pagó parcial con un monto que
//     no cuadra): se deja sin tocar y se imprime para revisar a mano.
//
// Si el pendiente ya tenía algo COBRADO (consumed > 0) y el monto corregido queda por debajo de
// lo cobrado, se avisa con [OJO] -- puede significar que ya se le pagó de más (incluyendo la
// parte de mesas que ahora se saca) y hay que revisar ese caso a mano.
//
//   - Sin --apply: SOLO IMPRIME qué se va a corregir. No toca la base.
//   - Con --apply: aplica la corrección fila por fila, cada una en su propia transacción.
import { pool, newId } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");
const EPS = 0.01;

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

async function main() {
  const r = await pool.query(
    `SELECT rp.id as pendiente_id, rp.amount, rp.consumed,
            wc.id as closing_id, wc.week_start, wc.week_end, wc.result, wc.rakeback, wc.rebate,
            wc.rodeo, wc.ajuste_manual, wc.rebate_destino,
            a.name as agent_name, c.name as club_name
     FROM rakeback_pendiente rp
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     JOIN agents a ON a.id = rp.agent_id
     JOIN clubs c ON c.id = rp.club_id
     WHERE rp.role = 'AGENTE' AND rp.active = true
       AND wc.system = 'PREPAGO' AND wc.status <> 'REVERTIDO'
     ORDER BY a.name, c.name, wc.week_start`
  );

  if (r.rows.length === 0) {
    console.log("No hay rakeback pendiente activo de agentes PREPAGO -- nada para revisar.");
    await pool.end();
    return;
  }

  const aCorregir: typeof r.rows = [];
  const yaCorrectas: typeof r.rows = [];
  const revisarAMano: typeof r.rows = [];

  for (const row of r.rows) {
    const result = Number(row.result);
    const rebateComponente = row.rebate_destino === "RAKEBACK_SUPERVISOR" ? 0 : Number(row.rebate);
    const esperadoNuevo = Number(row.rakeback) + rebateComponente + Number(row.rodeo || 0) + Number(row.ajuste_manual || 0);
    const esperadoViejo = esperadoNuevo + result;
    const actual = Number(row.amount);

    (row as any)._esperadoNuevo = esperadoNuevo;

    if (Math.abs(actual - esperadoViejo) < EPS && Math.abs(result) > EPS) {
      aCorregir.push(row);
    } else if (Math.abs(actual - esperadoNuevo) < EPS) {
      yaCorrectas.push(row);
    } else {
      revisarAMano.push(row);
    }
  }

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN"} -- rakeback pendiente PREPAGO: sacar el resultado de mesas del monto pendiente.\n`);

  console.log(`A CORREGIR (${aCorregir.length}):`);
  for (const row of aCorregir) {
    const esperadoNuevo = (row as any)._esperadoNuevo as number;
    const consumed = Number(row.consumed);
    const ojo = consumed > esperadoNuevo + EPS ? "  [OJO: ya tiene cobrado más de lo que va a quedar pendiente -- revisar a mano]" : "";
    console.log(
      `  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)} al ${String(row.week_end).slice(0, 10)}): ` +
        `${fmt(Number(row.amount))} → ${fmt(esperadoNuevo)}  (resultado de mesas ${fmt(Number(row.result))} sale del pendiente)${ojo}`
    );
  }

  if (yaCorrectas.length > 0) {
    console.log(`\nYA CORRECTAS, no se tocan (${yaCorrectas.length}):`);
    for (const row of yaCorrectas) {
      console.log(`  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)}): ${fmt(Number(row.amount))}`);
    }
  }

  if (revisarAMano.length > 0) {
    console.log(`\nNO COINCIDEN CON NINGUNA FÓRMULA, revisar a mano (${revisarAMano.length}):`);
    for (const row of revisarAMano) {
      const esperadoNuevo = (row as any)._esperadoNuevo as number;
      console.log(
        `  ${row.agent_name} — ${row.club_name} (semana ${String(row.week_start).slice(0, 10)}): monto actual ${fmt(Number(row.amount))}, ` +
          `esperado nuevo ${fmt(esperadoNuevo)}, esperado viejo ${fmt(esperadoNuevo + Number(row.result))} -- no matchea ninguno.`
      );
    }
  }

  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN -- no se tocó nada. Correr con --apply para aplicar de verdad.");
    await pool.end();
    return;
  }

  for (const row of aCorregir) {
    const esperadoNuevo = (row as any)._esperadoNuevo as number;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE rakeback_pendiente SET amount = $1, updated_at = now() WHERE id = $2`, [esperadoNuevo, row.pendiente_id]);
      await client.query(
        `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes)
         SELECT $1, $2, agent_id, 'ALTA', $3, $4, consumed, $5 FROM rakeback_pendiente WHERE id = $2`,
        [
          newId("rpm"),
          row.pendiente_id,
          esperadoNuevo - Number(row.amount),
          esperadoNuevo,
          `Corrección 24/09/2026: se saca el resultado de mesas (${fmt(Number(row.result))}) del rakeback pendiente -- ese resultado queda solo de referencia, nunca genera pendiente de pago.`,
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

  console.log(`\nListo -- ${aCorregir.length} fila(s) corregida(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
