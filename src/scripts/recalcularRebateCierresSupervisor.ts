// Recalcula los cierres consolidados de supervisores PREPAGO ya aplicados que sumaron solo el rakeback a cuenta corriente
// (02/11/2026, pedido de Leo). Desde el commit 3d81562 el cierre suma rakeback + rebate del agente (salvo el rebate desviado al
// supervisor, rebate_destino = RAKEBACK_SUPERVISOR); los aplicados antes quedaron sin el rebate.
//
// Por cada línea todavía vieja (su rakeback guardado = el rakeback del cierre del agente) suma la diferencia:
// - supervisor_cierre_lineas.rakeback  -> lo que la línea suma a cuenta corriente (lo leen "Origen del saldo" y revertir)
// - supervisor_cierres.rakeback_total  -> idem para el cierre (revertir resta este número)
// - supervisor_cuentas.cuenta_corriente -> la diferencia total del supervisor
// y deja una nota en el cierre. Los saldos "antes/después" guardados en cada cierre y movimiento no se tocan (son fotos
// de ese momento). Se puede correr dos veces: una línea ya corregida no vuelve a sumar.
//
// Uso:
//   npx tsx src/scripts/recalcularRebateCierresSupervisor.ts            -> solo muestra lo que haría
//   npx tsx src/scripts/recalcularRebateCierresSupervisor.ts --aplicar  -> lo aplica
import { pool } from "../db/pool.js";

const APLICAR = process.argv.includes("--aplicar");

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const r = await pool.query(
    `SELECT s.id as supervisor_id, s.name as supervisor, sc.id as cierre_id, to_char(sc.week_start, 'DD/MM') as semana,
            l.id as linea_id, a.name as agente, c.name as club,
            l.rakeback as guardado, wc.rakeback, wc.rebate, wc.rebate_destino, wc.status as estado_cierre_agente
     FROM supervisor_cierre_lineas l
     JOIN supervisor_cierres sc ON sc.id = l.cierre_id
     JOIN agents s ON s.id = sc.supervisor_agent_id
     JOIN weekly_closings wc ON wc.id = l.weekly_closing_origen_id
     JOIN agents a ON a.id = l.agent_id
     JOIN clubs c ON c.id = l.club_id
     WHERE sc.status <> 'REVERTIDO' AND COALESCE(s.default_system, '') <> 'WIN_LOSE'
     ORDER BY s.name, sc.week_start, a.name, c.name`
  );

  const aCorregir: any[] = [];
  const raros: any[] = [];
  for (const row of r.rows) {
    const rebate = row.rebate_destino === "RAKEBACK_SUPERVISOR" ? 0 : Number(row.rebate);
    if (Math.abs(rebate) < 0.005) continue;
    const guardado = Number(row.guardado);
    const correcto = round2(Number(row.rakeback) + rebate);
    if (Math.abs(guardado - correcto) < 0.005) continue; // ya corregida
    // Solo se corrige si lo guardado es exactamente el rakeback viejo; si no, algo cambió después y conviene mirarlo a mano.
    if (Math.abs(guardado - Number(row.rakeback)) < 0.005) aCorregir.push({ ...row, diferencia: round2(correcto - guardado), correcto });
    else raros.push({ ...row, correcto });
  }

  if (aCorregir.length === 0) console.log("No hay líneas para corregir.");
  for (const x of aCorregir) {
    console.log(`${x.supervisor} · semana ${x.semana} · ${x.agente} · ${x.club}: ${money(Number(x.guardado))} -> ${money(x.correcto)} (${x.diferencia >= 0 ? "+" : ""}${money(x.diferencia)})${x.estado_cierre_agente === "REVERTIDO" ? "  [ojo: el cierre del agente está revertido]" : ""}`);
  }
  for (const x of raros) {
    console.log(`REVISAR A MANO: ${x.supervisor} · semana ${x.semana} · ${x.agente} · ${x.club}: guardado ${money(Number(x.guardado))}, rakeback ${money(Number(x.rakeback))}, correcto ${money(x.correcto)}`);
  }

  const porSupervisor = new Map<string, { nombre: string; total: number }>();
  for (const x of aCorregir) {
    const p = porSupervisor.get(x.supervisor_id) ?? { nombre: x.supervisor, total: 0 };
    p.total = round2(p.total + x.diferencia);
    porSupervisor.set(x.supervisor_id, p);
  }
  for (const p of porSupervisor.values()) console.log(`Total ${p.nombre}: cuenta corriente ${p.total >= 0 ? "+" : ""}${money(p.total)}`);

  if (!APLICAR) {
    console.log("\nModo de prueba: no se cambió nada. Para aplicarlo: --aplicar");
    process.exit(0);
  }
  if (aCorregir.length === 0) process.exit(0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const porCierre = new Map<string, number>();
    for (const x of aCorregir) {
      // Vuelve a chequear dentro de la transacción que la línea siga igual.
      const upd = await client.query(`UPDATE supervisor_cierre_lineas SET rakeback = $2 WHERE id = $1 AND rakeback = $3`, [x.linea_id, x.correcto, x.guardado]);
      if (upd.rowCount !== 1) throw new Error(`La línea ${x.linea_id} cambió mientras corría el script. No se aplicó nada.`);
      porCierre.set(x.cierre_id, round2((porCierre.get(x.cierre_id) ?? 0) + x.diferencia));
    }
    for (const [cierreId, dif] of porCierre) {
      await client.query(
        `UPDATE supervisor_cierres
         SET rakeback_total = rakeback_total + $2,
             notes = TRIM(COALESCE(notes, '') || ' Recalculado 02/11/2026: se sumó el rebate del agente a cuenta corriente (' || $3 || ').')
         WHERE id = $1`,
        [cierreId, dif, money(dif)]
      );
    }
    for (const [supervisorId, p] of porSupervisor) {
      const cta = await client.query(`SELECT id FROM supervisor_cuentas WHERE supervisor_agent_id = $1 FOR UPDATE`, [supervisorId]);
      if (!cta.rows[0]) throw new Error(`${p.nombre} no tiene cuenta consolidada. No se aplicó nada.`);
      await client.query(`UPDATE supervisor_cuentas SET cuenta_corriente = cuenta_corriente + $2, updated_at = now() WHERE id = $1`, [cta.rows[0].id, p.total]);
    }
    await client.query("COMMIT");
    console.log(`\nAplicado: ${aCorregir.length} línea(s) en ${porCierre.size} cierre(s) de ${porSupervisor.size} supervisor(es).`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
