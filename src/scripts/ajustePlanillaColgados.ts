// Ajuste de SOLO EJECUCIÓN MANUAL (no lo corro yo): cierra a cero los 13 pares agente+club que
// diffSaldosVsPlanilla.ts encontró con saldo distinto de cero en la base pero que YA NO
// aparecen como fila en la planilla de hoy (SALDOS_AGENTES). El sync normal
// (syncSaldosPlanilla.ts) no puede tocar estos pares porque solo actualiza pares que SÍ están
// en la planilla — si la fila desapareció (cuenta cerrada/consolidada/movida a otro club), el
// saldo viejo queda "colgado" acá sin que nada se entere.
//
// Esto explica gran parte de la diferencia entre el "AGENTES NOS DEBEN"/"DEBEMOS A AGENTES" de
// la planilla y el Resumen de la app: -2680.40 en Fénix Suprema y -1047.14 en OTRO, exactamente
// los totales de estos 13 pares.
//
//   - Sin --apply: SOLO IMPRIME qué se va a hacer. No toca la base.
//   - Con --apply: por cada par, inserta UN movimiento AJUSTE por el monto exacto necesario
//     para dejar el saldo en 0 (es decir, -saldoActual), fechado hoy, con idempotencyKey fija
//     (no depende de la fecha) para que si se corre más de una vez no se duplique.
//
// OJO — revisar a mano antes de aplicar (por eso estos dos NO se tratan distinto en el código,
// pero se listan acá para que los mires antes de correr con --apply):
//   - Fénix Suprema / M CHOCO: -2412.92, el más grande de todos. Podría haber sido reabsorbido
//     en la cuenta de Manzur en vez de simplemente saldado — confirmar antes de zanjarlo así
//     nomás.
//   - OTRO / El caiman: -1047.14. Podría haberse movido de club "OTRO" a "GG" en vez de haberse
//     cerrado — si es así, este ajuste sería un error (habría que recrear el saldo en GG, no
//     borrarlo).
//
// Si alguno de estos dos casos resulta ser un movimiento de cuenta (no un cierre real), sacalo
// de la lista de abajo antes de correr --apply, o corregilo aparte a mano.

import { getAgentByName, getClubByName } from "../repo/catalog.js";
import { registrarMovimiento, getBalance } from "../repo/ledger.js";
import { pool } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");

// Pares encontrados por diffSaldosVsPlanilla.ts el 10/09/2026. saldoEsperado son los montos
// reportados por ese script (el saldo actual en la base, que ya no tiene contraparte en la
// planilla) — el ajuste que se aplica es el opuesto exacto, para dejar el balance en 0.
// IMPORTANTE: estos nombres de agente son literalmente agents.name en la base (incluidos los
// prefijos "E ", "J ", "M ", "Mar ") porque diffSaldosVsPlanilla.ts los imprime directo desde
// `a.name` sin transformar nada — NO son abreviaturas a mapear como en syncSaldosPlanilla.ts.
// Si al correr esto (aunque sea sin --apply) alguno sale "No encontrado en catálogo", significa
// que el nombre real tiene alguna diferencia sutil (mayúsculas, espacios) — antes de tocar nada,
// confirmá el nombre exacto con una consulta a agents en vez de adivinar.
const PARES_COLGADOS: { club: string; agente: string; saldoActual: number }[] = [
  { club: "Fénix Suprema", agente: "E Betprolive", saldoActual: 21.96 },
  { club: "Fénix Suprema", agente: "E Carlos yba", saldoActual: -118.64 },
  { club: "Fénix Suprema", agente: "E CarlosTarija", saldoActual: -4.17 },
  { club: "Fénix Suprema", agente: "E Franky", saldoActual: 18.88 },
  { club: "Fénix Suprema", agente: "E Melito", saldoActual: 3.27 },
  { club: "Fénix Suprema", agente: "E Ricardo1", saldoActual: 0.07 },
  { club: "Fénix Suprema", agente: "E jefazo", saldoActual: -14.73 },
  { club: "Fénix Suprema", agente: "E mejorplo5", saldoActual: -73.16 },
  { club: "OTRO", agente: "El caiman", saldoActual: -1047.14 },
  { club: "Fénix Suprema", agente: "J Rodrigo Z", saldoActual: -50.28 },
  { club: "Fénix Suprema", agente: "M CHOCO", saldoActual: -2412.92 },
  { club: "Fénix Suprema", agente: "Mar Bruno", saldoActual: -59.19 },
  { club: "Fénix Suprema", agente: "TB  OTTI", saldoActual: 8.51 },
];

function fmt(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  console.log(
    `Modo: ${APPLY ? "APLICAR (se van a crear ajustes)" : "SOLO REPORTE (no se toca la base — corré con --apply para aplicar)"}\n`
  );
  console.log(`Pares a cerrar a 0: ${PARES_COLGADOS.length}\n`);

  let aplicados = 0;
  let sinCambios = 0;
  let noEncontrados = 0;

  for (const p of PARES_COLGADOS) {
    const agent = await getAgentByName(p.agente);
    const club = await getClubByName(p.club);
    if (!agent || !club) {
      noEncontrados++;
      console.log(`  ⚠ No encontrado en catálogo: agente="${p.agente}" (${agent ? "ok" : "FALTA"}) / club="${p.club}" (${club ? "ok" : "FALTA"}) — se omite.`);
      continue;
    }

    const balanceActual = await getBalance(agent.id, club.id);
    const saldoApp = balanceActual ? Number(balanceActual.amount) : 0;

    if (Math.abs(saldoApp) < 0.01) {
      sinCambios++;
      console.log(`  ${p.club} / ${p.agente}: ya está en 0 en la base (probablemente ya ajustado). Se omite.`);
      continue;
    }

    const ajuste = -saldoApp;
    console.log(`  ${p.club} / ${p.agente}: saldo actual ${fmt(saldoApp)}  →  ajuste ${fmt(ajuste)}  →  queda en 0`);

    if (APPLY) {
      await registrarMovimiento({
        idempotencyKey: `ajuste_colgado_planilla_${agent.id}_${club.id}`,
        type: "AJUSTE",
        clubId: club.id,
        agentId: agent.id,
        amount: ajuste,
        occurredAt: new Date(),
        paymentMethod: "SIN_TESORERIA",
        observation: `Cierre de saldo colgado: este par agente+club ya no aparece como fila en la planilla (cuenta cerrada/consolidada). Ajuste a 0 detectado por diffSaldosVsPlanilla.ts el 10/09/2026 — revisar si corresponde reasignar el saldo a otra cuenta antes de dar por bueno este cierre.`,
        createdBy: "ajuste:planilla-colgados",
      });
      aplicados++;
    }
  }

  console.log("\n── Resumen ──");
  console.log(`Pares ya en 0 (omitidos): ${sinCambios}`);
  console.log(`Pares no encontrados en el catálogo (omitidos): ${noEncontrados}`);
  if (APPLY) {
    console.log(`Ajustes aplicados: ${aplicados}`);
  } else {
    console.log(`\nNo se tocó la base todavía. Si esto tiene sentido (¡ojo con CHOCO y El caiman, ver comentario arriba!), corré:\n  npm run ajuste:colgados:apply`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
