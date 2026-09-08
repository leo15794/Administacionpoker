// Sincroniza los saldos actuales por agente+club contra lo que HOY dice la planilla
// "automatizacion clubes" (hoja SALDOS_AGENTES) — SOLO LECTURA de la planilla, nunca se
// le escribe nada.
//
// Por qué existe: los agentes siguen operando en paralelo en la planilla, así que con el
// tiempo el saldo que tenemos acá adentro se empieza a desalinear del saldo real. Este
// script compara, agente por agente y club por club, el saldo vigente en la planilla
// (saldos_planilla.json, generado leyendo la planilla en el momento de escribir esto) contra
// el saldo que tenemos en nuestra base, y:
//
//   - Sin --apply: SOLO IMPRIME el reporte de diferencias. No toca la base. Usalo primero
//     para revisar que las diferencias tengan sentido antes de aplicar nada.
//   - Con --apply: por cada par agente+club cuya diferencia sea de 1 centavo o más, inserta
//     UN movimiento tipo AJUSTE por el monto exacto de la diferencia, fechado hoy, dejando
//     registrado que fue una sincronización automática con la planilla (no un movimiento
//     real de dinero). Es seguro correrlo más de una vez el mismo día: cada ajuste tiene una
//     idempotencyKey con la fecha de hoy, así que si ya se aplicó, no se duplica.
//
// Lo que NO incluye a propósito (quedan listados aparte en el reporte, para revisar a mano):
//   - Filas de "Garantía": esas se manejan en la tabla `guarantees`, separada del balance.
//   - Filas de "Adelanto de rakeback": no está claro si ya están reflejadas en otro lado del
//     saldo operativo, así que no se tocan automáticamente para no duplicar ni pisar nada.
//   - Filas "Histórico / inactivo": saldo residual de una cuenta cerrada, no un saldo vigente.
//
// Agentes/clubes que no existen en el catálogo NO se crean automáticamente acá (a diferencia
// del importador de historial) — quedan listados para que decidas si corresponde darlos de
// alta o si son cuentas internas/de prueba que no deberían estar en el sistema.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { getAgentByName, getClubByName } from "../repo/catalog.js";
import { registrarMovimiento, getBalance } from "../repo/ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

interface FilaDetalle {
  concepto: string;
  situacion: string;
  monto: number;
}
interface SaldoPlanilla {
  club: string;
  agente: string;
  saldoPlanilla: number;
  filas: FilaDetalle[];
}
interface DataFile {
  generadoEn: string;
  saldos: SaldoPlanilla[];
  excluidos: any[];
}

function fmt(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, "saldos_planilla.json"), "utf-8");
  const data: DataFile = JSON.parse(raw);
  const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  console.log(`Modo: ${APPLY ? "APLICAR (se van a crear ajustes)" : "SOLO REPORTE (no se toca la base — corré con --apply para aplicar)"}`);
  console.log(`Saldos leídos de la planilla al ${data.generadoEn}: ${data.saldos.length} pares agente+club.\n`);

  if (data.excluidos.length > 0) {
    console.log(`── Filas excluidas del ajuste automático (revisar a mano) ──`);
    for (const e of data.excluidos) {
      console.log(`  ${e.club} / ${e.agente} — ${e.concepto} (${e.situacion}): ${fmt(e.monto)}`);
    }
    console.log("");
  }

  let sinCambios = 0;
  let conDiferencia = 0;
  let noEncontrados = 0;
  let aplicados = 0;

  console.log(`── Comparación saldo planilla vs. saldo en la base ──`);
  for (const s of data.saldos) {
    const agent = await getAgentByName(s.agente);
    const club = await getClubByName(s.club);
    if (!agent || !club) {
      noEncontrados++;
      console.log(`  ⚠ No encontrado en catálogo: agente="${s.agente}" (${agent ? "ok" : "FALTA"}) / club="${s.club}" (${club ? "ok" : "FALTA"}) — saldo planilla ${fmt(s.saldoPlanilla)}, se omite.`);
      continue;
    }
    const balanceActual = await getBalance(agent.id, club.id);
    const saldoApp = balanceActual ? Number(balanceActual.amount) : 0;
    const diferencia = s.saldoPlanilla - saldoApp;

    if (Math.abs(diferencia) < 0.01) {
      sinCambios++;
      continue;
    }

    conDiferencia++;
    console.log(
      `  ${s.club} / ${s.agente}: planilla ${fmt(s.saldoPlanilla)}  vs  app ${fmt(saldoApp)}  →  diferencia ${fmt(diferencia)}`
    );

    if (APPLY) {
      await registrarMovimiento({
        idempotencyKey: `sync_planilla_${hoy}_${agent.id}_${club.id}`,
        type: "AJUSTE",
        clubId: club.id,
        agentId: agent.id,
        amount: diferencia,
        occurredAt: new Date(),
        paymentMethod: "SIN_TESORERIA",
        observation: `Sincronización automática con la planilla (estado al ${data.generadoEn}). No representa un movimiento real de dinero — corrige el desfasaje entre el saldo operado en la planilla y el saldo cargado acá.`,
        createdBy: "sync:saldos-planilla",
      });
      aplicados++;
    }
  }

  console.log("\n── Resumen ──");
  console.log(`Pares sin diferencia (ya coinciden): ${sinCambios}`);
  console.log(`Pares con diferencia detectada: ${conDiferencia}`);
  console.log(`Pares no encontrados en el catálogo (omitidos): ${noEncontrados}`);
  if (APPLY) {
    console.log(`Ajustes aplicados: ${aplicados}`);
  } else if (conDiferencia > 0) {
    console.log(`\nNo se tocó la base todavía. Si las diferencias de arriba tienen sentido, corré:\n  npm run sync:saldos:apply`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
