// Suma el rake de Spin que faltó en los cierres de Suprema de una semana ya aplicada (02/11/2026, pedido de Leo).
// En la semana del 26/10 Suprema renombró la columna "Total Stakes Spin(Local)" a "Total Stakes Spin" y la importación dejó el
// Spin en 0 (arreglado en engine/importSuprema.ts, commit bdc53b2). Este script relee el MISMO archivo con el parser arreglado y,
// jugador por jugador, suma lo que faltó sin rehacer los cierres:
//
// - weekly_closing_player_details: rake, rakeback y cierre del jugador (y subagente, si tiene).
// - weekly_closings: spin, rake_total, rakeback, adjusted_result y final_closing (rebate 0 y sin regla especial: si no, frena).
//   Agente "solo referencia": solo ref_rake (su cierre operativo sigue en 0).
// - Lo que ya se aplicó con ese cierre: líneas de cierres consolidados de supervisor (y su cuenta corriente), líneas AGENTE de
//   cierres de proveedor (y el saldo del proveedor en ese club) y la entrada en la cuenta de socio si el cierre se ruteó ahí.
// Frena sin cambiar nada si encuentra algo que no sabe corregir (rakeback pendiente, comisión por referido, una línea CLUB de
// proveedor ya aplicada con ese club y semana). Un cierre que ya tiene Spin no se toca, así que se puede correr dos veces.
//
// Uso:
//   npx tsx src/scripts/corregirSpinSemana.ts "<archivo.xlsx>" 2026-10-26            -> solo muestra lo que haría
//   npx tsx src/scripts/corregirSpinSemana.ts "<archivo.xlsx>" 2026-10-26 --aplicar  -> lo aplica
import { readFileSync } from "node:fs";
import { pool } from "../db/pool.js";
import { parseSupremaWorkbook } from "../engine/importSuprema.js";

const [archivo, weekStart] = process.argv.slice(2);
const APLICAR = process.argv.includes("--aplicar");

function round4(n: number) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}
function money(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function clubDeHoja(nombre: string): string | null {
  const n = nombre.toUpperCase();
  if (n.includes("FENIX") || n.includes("FÉNIX")) return "Fénix Suprema";
  if (n === "TB" || n.includes("TEAMBACK")) return "TeamBack Suprema";
  return null;
}

async function main() {
  if (!archivo || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart ?? "")) {
    console.error('Uso: npx tsx src/scripts/corregirSpinSemana.ts "<archivo.xlsx>" AAAA-MM-DD [--aplicar]');
    process.exit(1);
  }
  const parse = await parseSupremaWorkbook(readFileSync(archivo));

  // Spin por jugador y club, según el archivo.
  const spinPorJugador: { club: string; playerId: string; playerName: string; spin: number }[] = [];
  for (const hoja of parse.sheets) {
    const club = clubDeHoja(hoja.sheetName);
    if (!club) throw new Error(`No sé a qué club corresponde la hoja "${hoja.sheetName}".`);
    for (const r of hoja.rows) if (r.spin && Math.abs(r.spin) > 0.00001) spinPorJugador.push({ club, playerId: r.playerId, playerName: r.playerName, spin: r.spin });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Ubica el cierre de cada jugador por el detalle guardado al importar.
    const porCierre = new Map<string, { jugadores: { detalleId: string | null; spin: number; nombre: string }[] }>();
    const sinCierre: string[] = [];
    for (const j of spinPorJugador) {
      const d = await client.query(
        `SELECT d.id, d.closing_id FROM weekly_closing_player_details d
         JOIN weekly_closings wc ON wc.id = d.closing_id JOIN clubs c ON c.id = wc.club_id
         WHERE c.name = $1 AND wc.week_start = $2::date AND wc.status <> 'REVERTIDO' AND d.player_external_id = $3`,
        [j.club, weekStart, j.playerId]
      );
      if (d.rows.length === 1) {
        const g = porCierre.get(d.rows[0].closing_id) ?? { jugadores: [] };
        g.jugadores.push({ detalleId: d.rows[0].id, spin: j.spin, nombre: j.playerName });
        porCierre.set(d.rows[0].closing_id, g);
        continue;
      }
      // Sin detalle (por ejemplo un agente solo de referencia): se busca por el jugador en el catálogo.
      const p = await client.query(
        `SELECT wc.id FROM players p JOIN clubs c ON c.id = p.club_id
         JOIN weekly_closings wc ON wc.agent_id = p.agent_id AND wc.club_id = p.club_id
         WHERE c.name = $1 AND p.external_id = $2 AND wc.week_start = $3::date AND wc.status <> 'REVERTIDO'`,
        [j.club, j.playerId, weekStart]
      );
      if (p.rows.length === 1) {
        const g = porCierre.get(p.rows[0].id) ?? { jugadores: [] };
        g.jugadores.push({ detalleId: null, spin: j.spin, nombre: j.playerName });
        porCierre.set(p.rows[0].id, g);
      } else {
        sinCierre.push(`${j.club} · ${j.playerName} (${j.playerId}): Spin ${money(j.spin)}`);
      }
    }

    const problemas: string[] = [];
    let cambios = 0;
    for (const [closingId, g] of porCierre) {
      const wcRes = await client.query(
        `SELECT wc.*, a.name as agente, a.solo_referencia, c.name as club FROM weekly_closings wc
         JOIN agents a ON a.id = wc.agent_id JOIN clubs c ON c.id = wc.club_id WHERE wc.id = $1 FOR UPDATE OF wc`,
        [closingId]
      );
      const wc = wcRes.rows[0];
      const tasa = Number(wc.rate_snapshot) || 1;
      const dRake = round4(g.jugadores.reduce((s, x) => s + x.spin, 0) / tasa);
      if (Math.abs(Number(wc.spin ?? 0)) > 0.00001) {
        console.log(`${wc.club} · ${wc.agente}: ya tiene Spin (${money(Number(wc.spin))}), no se toca.`);
        continue;
      }

      if (wc.solo_referencia) {
        console.log(`${wc.club} · ${wc.agente} (solo referencia): rake de referencia ${money(Number(wc.ref_rake ?? 0))} -> ${money(Number(wc.ref_rake ?? 0) + dRake)}`);
        await client.query(`UPDATE weekly_closings SET ref_rake = COALESCE(ref_rake, 0) + $2, spin = $2 WHERE id = $1`, [closingId, dRake]);
        cambios++;
        continue;
      }
      if (wc.rule_applied || Math.abs(Number(wc.rebate_pct)) > 0.00001 || wc.supervisor_agent_id) {
        problemas.push(`${wc.club} · ${wc.agente}: tiene regla especial, rebate o rebate al supervisor; corregir a mano.`);
        continue;
      }
      const pct = Number(wc.rakeback_pct);
      const dRb = round4(dRake * pct);
      console.log(
        `${wc.club} · ${wc.agente}: Spin +${money(dRake)} · rake ${money(Number(wc.rake_total))} -> ${money(Number(wc.rake_total) + dRake)} · rakeback ${money(Number(wc.rakeback))} -> ${money(Number(wc.rakeback) + dRb)} · cierre ${money(Number(wc.final_closing))} -> ${money(Number(wc.final_closing) + dRb)}`
      );

      for (const j of g.jugadores) {
        if (!j.detalleId) continue;
        await client.query(
          `UPDATE weekly_closing_player_details
           SET rake = rake + $2, rakeback = rakeback + $2 * rakeback_pct, cierre_jugador = cierre_jugador + $2 * rakeback_pct,
               subagente_rakeback = CASE WHEN subagente_rakeback_pct IS NULL THEN subagente_rakeback ELSE subagente_rakeback + $2 * subagente_rakeback_pct END,
               subagente_cierre = CASE WHEN subagente_rakeback_pct IS NULL THEN subagente_cierre ELSE subagente_cierre + $2 * subagente_rakeback_pct END
           WHERE id = $1`,
          [j.detalleId, round4(j.spin / tasa)]
        );
      }
      await client.query(
        `UPDATE weekly_closings SET spin = $2, rake_total = rake_total + $2, rakeback = rakeback + $3,
           adjusted_result = adjusted_result + $3, final_closing = final_closing + $3 WHERE id = $1`,
        [closingId, dRake, dRb]
      );
      await client.query(
        `UPDATE ledger_movements SET observation = observation || $3
         WHERE type = 'CIERRE_SEMANAL' AND agent_id = $1 AND club_id = $2 AND idempotency_key = 'cierre:' || $1 || ':' || $2 || ':' || $4`,
        [wc.agent_id, wc.club_id, ` [Corregido 02/11/2026: faltaba el Spin (+${money(dRake)} de rake, +${money(dRb)} de rakeback).]`, weekStart]
      );
      cambios++;

      // Lo que ya se aplicó con este cierre.
      const pend = await client.query(`SELECT 1 FROM rakeback_pendiente WHERE weekly_closing_id = $1`, [closingId]);
      if (pend.rows.length > 0) problemas.push(`${wc.agente}: tiene rakeback pendiente de este cierre; corregir a mano.`);
      const refe = await client.query(`SELECT 1 FROM supervisor_referido_movements WHERE weekly_closing_id = $1`, [closingId]);
      if (refe.rows.length > 0) problemas.push(`${wc.agente}: generó comisión por referido; corregir a mano.`);

      const lineasSup = await client.query(
        `SELECT l.id, sc.id as cierre_id, s.id as sup_id, s.name as sup, s.default_system FROM supervisor_cierre_lineas l
         JOIN supervisor_cierres sc ON sc.id = l.cierre_id JOIN agents s ON s.id = sc.supervisor_agent_id
         WHERE l.weekly_closing_origen_id = $1 AND sc.status <> 'REVERTIDO'`,
        [closingId]
      );
      for (const l of lineasSup.rows) {
        // Prepago: la línea suma rakeback + rebate a cuenta corriente; Win/Lose: el cierre completo. Con rebate 0, las dos suben dRb.
        await client.query(`UPDATE supervisor_cierre_lineas SET rake_total = rake_total + $2, rakeback = rakeback + $3 WHERE id = $1`, [l.id, dRake, dRb]);
        await client.query(
          `UPDATE supervisor_cierres SET rake_total = rake_total + $2, rakeback_total = rakeback_total + $3,
             notes = TRIM(COALESCE(notes, '') || ' Corregido 02/11/2026: Spin de ' || $4 || ' (+' || $5 || ').') WHERE id = $1`,
          [l.cierre_id, dRake, dRb, wc.agente, money(dRb)]
        );
        await client.query(`UPDATE supervisor_cuentas SET cuenta_corriente = cuenta_corriente + $2, updated_at = now() WHERE supervisor_agent_id = $1`, [l.sup_id, dRb]);
        console.log(`   -> supervisor ${l.sup}: cuenta corriente +${money(dRb)}`);
      }

      const lineasProv = await client.query(
        `SELECT l.id, l.club_id, pc.id as cierre_id, pc.proveedor_id, p.name as prov FROM proveedor_cierre_lineas l
         JOIN proveedor_cierres pc ON pc.id = l.cierre_id JOIN proveedores p ON p.id = pc.proveedor_id
         WHERE l.weekly_closing_id = $1 AND l.tipo = 'AGENTE' AND pc.status = 'APLICADO'`,
        [closingId]
      );
      for (const l of lineasProv.rows) {
        // Línea AGENTE de un agente común: su monto es el cierre del agente tal cual (ver montoAgenteDeCierre en repo/proveedores.ts).
        await client.query(
          `UPDATE proveedor_cierre_lineas SET monto_crudo = monto_crudo + $2, monto_aplicado = monto_aplicado + $2, saldo_nuevo = saldo_nuevo + $2,
             notes = TRIM(COALESCE(notes, '') || ' Corregido 02/11/2026: faltaba el Spin.') WHERE id = $1`,
          [l.id, dRb]
        );
        await client.query(`UPDATE proveedor_cierres SET cierre = cierre + $2, saldo_nuevo = saldo_nuevo + $2 WHERE id = $1`, [l.cierre_id, dRb]);
        const s = await client.query(`UPDATE proveedor_saldos SET amount = amount + $3, updated_at = now() WHERE proveedor_id = $1 AND club_id = $2`, [l.proveedor_id, l.club_id, dRb]);
        if (s.rowCount !== 1) problemas.push(`${wc.agente}: no encontré el saldo del proveedor ${l.prov} en ese club.`);
        console.log(`   -> proveedor ${l.prov}: línea y saldo +${money(dRb)}`);
      }

      if (wc.routed_to_partner_account_id) {
        // La cuenta de socio guarda el cierre con el signo dado vuelta (ver aplicarCierreCompensacionPersonaTx en repo/closings.ts).
        const e = await client.query(
          `UPDATE partner_account_entries SET amount = amount - $2, updated_at = now(),
             notes = TRIM(COALESCE(notes, '') || ' Corregido 02/11/2026: faltaba el Spin.')
           WHERE idempotency_key = 'cierre_persona:' || $1 || ':' || $3 || ':' || $4`,
          [wc.agent_id, dRb, wc.club_id, weekStart]
        );
        if (e.rowCount !== 1) problemas.push(`${wc.agente}: no encontré su entrada en la cuenta de socio.`);
        else console.log(`   -> cuenta de socio: -${money(dRb)}`);
      }

      const clubProv = await client.query(
        `SELECT p.name FROM proveedor_cierre_lineas l JOIN proveedor_cierres pc ON pc.id = l.cierre_id JOIN proveedores p ON p.id = pc.proveedor_id
         WHERE l.tipo = 'CLUB' AND l.club_id = $1 AND pc.week_start = $2::date AND pc.status = 'APLICADO'`,
        [wc.club_id, weekStart]
      );
      if (clubProv.rows.length > 0) problemas.push(`${wc.club}: ya hay un cierre de proveedor (${clubProv.rows[0].name}) con este club y semana; desaplicalo y rehacelo.`);
    }

    for (const s of sinCierre) console.log(`Sin cierre cargado esa semana (no se corrige): ${s}`);
    if (problemas.length > 0) {
      for (const p of problemas) console.log(`FRENA: ${p}`);
      await client.query("ROLLBACK");
      console.log("\nNo se cambió nada.");
      process.exit(1);
    }
    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log(`\nModo de prueba: ${cambios} cierre(s) para corregir, no se cambió nada. Para aplicarlo: --aplicar`);
    } else {
      await client.query("COMMIT");
      console.log(`\nAplicado: ${cambios} cierre(s) corregidos.`);
    }
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
