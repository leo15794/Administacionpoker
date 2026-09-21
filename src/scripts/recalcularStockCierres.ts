// Recálculo retroactivo de cierres semanales (22/09/2026, pedido de Leo): desde el commit
// "Separar stock físico (Win/Lose) de rakeback/rebate pendiente en cierres", un cierre NUEVO
// solo mueve el stock/balance del agente por el resultado de mesas (Win/Lose = weekly_closings.
// result) -- todo lo demás (rakeback, rebate, Rodeo, ajuste manual) queda como fila en
// rakeback_pendiente. Los cierres cargados ANTES de ese commit siguen con el formato viejo: su
// movimiento CIERRE_SEMANAL en el ledger tiene el monto económico completo (rakeback/rebate/
// Rodeo/ajuste incluidos), mezclado con el stock físico.
//
// Este script es de SOLO LECTURA -- no escribe nada en la base todavía. Recorre todo el
// historial de cierres "genéricos" (no Bancado, no ruteados a cuenta de socio -- esos dos
// sistemas no usan balances/ledger de la misma forma y quedan afuera de este cambio) y para
// cada cierre viejo (el que todavía no tiene su fila en rakeback_pendiente) calcula cuánto de
// su monto actual en el ledger debería salir del balance del agente/supervisor y pasar a
// rakeback pendiente.
//
// Correr con: npx tsx src/scripts/recalcularStockCierres.ts
// (o "npm run recalcular:stock" -- ver package.json)
//
// Este reporte es para que Leo lo revise antes de decidir si se aplica la corrección de verdad.
// La corrección real (crear los AJUSTE que sacan la plata del balance + las filas de
// rakeback_pendiente) todavía NO está implementada -- se hace en un paso aparte, con --apply,
// una vez que estos números estén confirmados.

import { pool } from "../db/pool.js";
import fs from "node:fs";

function fmt(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Fila {
  weeklyClosingId: string;
  weekStart: string;
  weekEnd: string;
  agentName: string;
  clubName: string;
  ruleApplied: string | null;
  result: number;
  finalClosing: number;
  montoLedgerActual: number | null;
  pendienteAgente: number;
  supervisorName: string | null;
  montoSupervisorActual: number | null;
  pendienteSupervisor: number;
  inconsistencia: string | null;
}

async function main() {
  console.log("Modo: SOLO REPORTE (no se toca la base) -- recálculo retroactivo de cierres semanales.\n");

  const closingsRes = await pool.query(
    `SELECT wc.*, a.name as agent_name, c.name as club_name, sup.name as supervisor_name
     FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     LEFT JOIN agents sup ON sup.id = wc.supervisor_agent_id
     WHERE wc.status IN ('APLICADO','CORREGIDO')
       AND (wc.rule_applied IS DISTINCT FROM 'BANCADO')
       AND wc.routed_to_partner_account_id IS NULL
     ORDER BY wc.week_start, a.name`
  );

  console.log(`Cierres activos candidatos (no Bancado, no cuenta de socio): ${closingsRes.rows.length}\n`);

  const yaMigrados = new Set<string>();
  const migRes = await pool.query(`SELECT DISTINCT weekly_closing_id FROM rakeback_pendiente`);
  for (const r of migRes.rows) yaMigrados.add(r.weekly_closing_id);

  const filas: Fila[] = [];
  let saltadosYaMigrados = 0;

  for (const wc of closingsRes.rows) {
    if (yaMigrados.has(wc.id)) {
      saltadosYaMigrados++;
      continue; // ya tiene su fila de rakeback_pendiente -- cierre nuevo, formato correcto.
    }

    const movRes = await pool.query(
      `SELECT * FROM ledger_movements WHERE idempotency_key = $1`,
      [`cierre:${wc.agent_id}:${wc.club_id}:${wc.week_start}`]
    );
    const mov = movRes.rows[0];

    let inconsistencia: string | null = null;
    let montoLedgerActual: number | null = null;
    if (!mov) {
      inconsistencia = "No se encontró el movimiento CIERRE_SEMANAL en el ledger (dato viejo/inconsistente) -- revisar a mano.";
    } else if (mov.status !== "APLICADO") {
      inconsistencia = `El movimiento del ledger tiene status ${mov.status} (no APLICADO) -- probablemente ya se revirtió por otro lado.`;
      montoLedgerActual = Number(mov.amount);
    } else {
      montoLedgerActual = Number(mov.amount);
    }

    const result = Number(wc.result);
    const pendienteAgente = montoLedgerActual !== null ? montoLedgerActual - result : 0;

    let montoSupervisorActual: number | null = null;
    let pendienteSupervisor = 0;
    if (wc.supervisor_agent_id && wc.supervisor_movement_id) {
      const supMovRes = await pool.query(`SELECT * FROM ledger_movements WHERE id = $1`, [wc.supervisor_movement_id]);
      const supMov = supMovRes.rows[0];
      if (!supMov) {
        inconsistencia = (inconsistencia ? inconsistencia + " " : "") + "No se encontró el movimiento del supervisor (supervisor_movement_id) -- revisar a mano.";
      } else {
        montoSupervisorActual = Number(supMov.amount);
        if (supMov.status === "APLICADO") {
          pendienteSupervisor = montoSupervisorActual;
        } else {
          inconsistencia = (inconsistencia ? inconsistencia + " " : "") + `El movimiento del supervisor tiene status ${supMov.status} -- ya revertido por otro lado.`;
        }
      }
    }

    if (Math.abs(pendienteAgente) < 0.005 && Math.abs(pendienteSupervisor) < 0.005 && !inconsistencia) {
      continue; // cierre viejo pero sin rakeback/rebate/rodeo/ajuste (pura mesa) -- nada que corregir.
    }

    filas.push({
      weeklyClosingId: wc.id,
      weekStart: wc.week_start,
      weekEnd: wc.week_end,
      agentName: wc.agent_name,
      clubName: wc.club_name,
      ruleApplied: wc.rule_applied,
      result,
      finalClosing: Number(wc.final_closing),
      montoLedgerActual,
      pendienteAgente,
      supervisorName: wc.supervisor_name,
      montoSupervisorActual,
      pendienteSupervisor,
      inconsistencia,
    });
  }

  console.log(`Ya migrados (formato nuevo, sin cambios): ${saltadosYaMigrados}`);
  console.log(`Cierres viejos que necesitarían corrección: ${filas.length}\n`);

  const inconsistentes = filas.filter((f) => f.inconsistencia);
  if (inconsistentes.length) {
    console.log(`⚠ Inconsistencias encontradas (${inconsistentes.length}) -- revisar a mano antes de aplicar nada:\n`);
    for (const f of inconsistentes) {
      console.log(`  [${f.weekStart} a ${f.weekEnd}] ${f.agentName} / ${f.clubName}: ${f.inconsistencia}`);
    }
    console.log("");
  }

  // Agregado por agente+club: cuánto tendría que salir de su balance en total.
  // Las filas con inconsistencia (ej. el movimiento ya está REVERTIDO) NO entran en los
  // totales -- el monto guardado ahí no es confiable para calcular cuánto corregir. Quedan
  // solo en el detalle de "Inconsistencias" de arriba para revisar a mano.
  const porAgenteClub = new Map<string, { agente: string; club: string; total: number }>();
  for (const f of filas) {
    if (f.inconsistencia) continue;
    if (!f.montoLedgerActual && f.montoLedgerActual !== 0) continue;
    const key = `${f.agentName}||${f.clubName}`;
    const prev = porAgenteClub.get(key) ?? { agente: f.agentName, club: f.clubName, total: 0 };
    prev.total += f.pendienteAgente;
    porAgenteClub.set(key, prev);
  }
  const porSupervisor = new Map<string, { supervisor: string; total: number }>();
  for (const f of filas) {
    if (f.inconsistencia) continue;
    if (!f.supervisorName || Math.abs(f.pendienteSupervisor) < 0.005) continue;
    const prev = porSupervisor.get(f.supervisorName) ?? { supervisor: f.supervisorName, total: 0 };
    prev.total += f.pendienteSupervisor;
    porSupervisor.set(f.supervisorName, prev);
  }

  if (inconsistentes.length) {
    console.log(`(los ${inconsistentes.length} cierre(s) con inconsistencia de arriba quedan afuera de los totales de abajo -- revisalos a mano)\n`);
  }
  console.log("── Total a mover del balance a rakeback pendiente, por agente+club ──");
  let totalGeneral = 0;
  for (const { agente, club, total } of [...porAgenteClub.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))) {
    console.log(`  ${agente} / ${club}: ${fmt(total)}`);
    totalGeneral += total;
  }
  console.log(`  TOTAL: ${fmt(totalGeneral)}\n`);

  if (porSupervisor.size) {
    console.log("── Total a mover del balance a rakeback pendiente, por supervisor (rebate centralizado, formato viejo) ──");
    let totalSup = 0;
    for (const { supervisor, total } of porSupervisor.values()) {
      console.log(`  ${supervisor}: ${fmt(total)}`);
      totalSup += total;
    }
    console.log(`  TOTAL: ${fmt(totalSup)}\n`);
  }

  // CSV detallado, uno por cierre, para revisar en Excel.
  const csvPath = "recalculo-stock-cierres-dry-run.csv";
  const header = [
    "weekly_closing_id", "week_start", "week_end", "agente", "club", "regla",
    "result_win_lose", "final_closing_viejo", "monto_ledger_actual",
    "pendiente_agente_a_mover", "supervisor", "monto_supervisor_actual",
    "pendiente_supervisor_a_mover", "inconsistencia",
  ];
  const lines = [header.join(",")];
  for (const f of filas) {
    lines.push(
      [
        f.weeklyClosingId, f.weekStart, f.weekEnd, `"${f.agentName}"`, `"${f.clubName}"`, f.ruleApplied ?? "",
        f.result.toFixed(2), f.finalClosing.toFixed(2), f.montoLedgerActual !== null ? f.montoLedgerActual.toFixed(2) : "",
        f.pendienteAgente.toFixed(2), f.supervisorName ? `"${f.supervisorName}"` : "",
        f.montoSupervisorActual !== null ? f.montoSupervisorActual.toFixed(2) : "",
        f.pendienteSupervisor.toFixed(2), f.inconsistencia ? `"${f.inconsistencia.replace(/"/g, "'")}"` : "",
      ].join(",")
    );
  }
  fs.writeFileSync(csvPath, lines.join("\n"), "utf-8");
  console.log(`Detalle fila por fila guardado en: ${csvPath} (${filas.length} filas)`);
  console.log("\nNo se tocó la base. Cuando confirmes estos números, armamos el paso --apply.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
