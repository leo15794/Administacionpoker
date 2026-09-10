// Reconstrucción de SOLO PANTALLA (no toca plata) de los cierres semanales que faltan en
// weekly_closings para las semanas 24/08–30/08 y 31/08–06/09 de 2026.
//
// Por qué existe: el "Estado de cuenta" de cada agente arma su desglose semanal (Resultado /
// Rake / % RB / Rakeback / Rebate / Cierre final) leyendo weekly_closings — pero esa tabla
// dejó de cargarse en agosto. La hoja de cálculo SÍ siguió cerrando semanas después de esa
// fecha (tabla HISTORIAL_SALDOS_AGENTES), pero desde la semana 17/08–23/08 en adelante el
// proceso que arma el desglose fila-por-fila (ESTADO_CUENTA_AGENTE, columnas K:T) quedó
// congelado — HISTORIAL_SALDOS_AGENTES solo tiene el MONTO NETO de la semana por "agente
// unificado", sin Resultado/Rake/Rakeback reales.
//
// Qué hace este script: para los pares agente+club de UN SOLO agente y UN SOLO club (ver
// PARES_EXCLUIDOS más abajo para los que NO entran acá), inserta una fila en weekly_closings
// con:
//   - final_closing = el monto neto de esa semana (dato real, de HISTORIAL_SALDOS_AGENTES)
//   - result = mismo monto (no hay forma de saber cuánto fue Resultado vs Rake vs Rakeback)
//   - rake_total / rakeback / rebate = 0 (NO son ceros reales — son "no disponible", ver nota)
//   - rule_applied = "RECONSTRUIDO_SIN_DESGLOSE" y una observación bien visible explicando la
//     limitación, para que nadie lo confunda con un cierre cargado normalmente.
//
// LO QUE NO HACE (a propósito): no crea ningún movimiento en ledger_movements ni toca
// `balances`. El saldo de cada agente YA está corregido al valor actual de la planilla vía
// sync:saldos / ajuste:colgados — sumarle además el "cierre" de estas semanas duplicaría esa
// plata. Esto es puramente para que el desglose semanal de Estado de cuenta no se vea vacío.
//
// Pares EXCLUIDOS a propósito (quedan listados para que los cargues a mano si tenés el detalle
// real, o los dejes así):
//   - EDWAR (junta 8 agentes de Fénix en un solo número)
//   - Manzur, Rodrigo (mezclan Fénix + Fénix GG)
//   - Mar Mari (mezcla Mar Bruno + Mar Mari)
//   - Prodigio (mezcla 3-4 clubes)
//   - Marcelo Mereles (mezcla GG + Fénix GG)
//   - JJ DD (mezcla TeamBack Suprema + X-Poker, semana 31/08-06/09)
//   - cajerouy (mezcla cajerouy + UY allinuy, semana 31/08-06/09)
//   - nico (mezcla N matiass + nico, semana 31/08-06/09)
//   - Matias Fontal (es BANCADO — usa un motor de cierre distinto, no aplica acá)
//   - DigiPlayers/teamback (cuenta interna, no es un agente real)
//   - Unión TeamBack GG (settlement entre clubes, no es un agente)
//
//   - Sin --apply: SOLO IMPRIME el reporte. No toca la base.
//   - Con --apply: inserta las filas. Es seguro correr más de una vez — antes de insertar,
//     chequea si ya existe un weekly_closing activo (no REVERTIDO) para ese agente+club+semana
//     y lo omite si ya está.

import { getAgentByName, getClubByName } from "../repo/catalog.js";
import { pool, newId } from "../db/pool.js";

const APPLY = process.argv.includes("--apply");

interface Fila {
  weekStart: string;
  weekEnd: string;
  agente: string;
  clubDb: string;
  sistema: "Prepago" | "Win/Lose";
  cierre: number;
  estado: string;
}

// Extraído de HISTORIAL_SALDOS_AGENTES (export de la planilla del 10/09/2026), filtrado a
// filas de un solo agente + un solo club. Ver el bloque EXCLUIDOS en el comentario de arriba
// para las que se dejaron afuera a propósito.
const FILAS: Fila[] = [
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "cajerouy", clubDb: "Fénix Suprema", sistema: "Prepago", cierre: -244.545, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "F Roesca17", clubDb: "Fénix Suprema", sistema: "Win/Lose", cierre: 0.0, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "TB OTTI", clubDb: "Fénix Suprema", sistema: "Prepago", cierre: -10.208, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "J Lenzo", clubDb: "TeamBack Suprema", sistema: "Prepago", cierre: -14.31, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "JJ DD", clubDb: "TeamBack Suprema", sistema: "Win/Lose", cierre: -8.241, estado: "APLICADO · CORREGIDO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "nico", clubDb: "TeamBack Suprema", sistema: "Win/Lose", cierre: -696.23, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "patoruzit0", clubDb: "TeamBack Suprema", sistema: "Win/Lose", cierre: -346.515, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "TB dementus22", clubDb: "TeamBack Suprema", sistema: "Prepago", cierre: -12.188, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "daylight25", clubDb: "TeamBack GG", sistema: "Prepago", cierre: -32.3415, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "El Latigo Loco", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: 502.5387, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "El caiman", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: -652.944, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "MacT-GG", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: -134.523, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "QueDificil", clubDb: "TeamBack GG", sistema: "Prepago", cierre: 1226.364, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "Demiurge29", clubDb: "Fénix GG", sistema: "Prepago", cierre: -5489.97, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "JereStack", clubDb: "Fénix GG", sistema: "Prepago", cierre: 613.94, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "renacapkr", clubDb: "Fénix GG", sistema: "Prepago", cierre: -214.1025, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "MutiladorDoc", clubDb: "Tiny GG", sistema: "Prepago", cierre: -688.3822, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "Jinx Wang Chan", clubDb: "Tiny GG", sistema: "Prepago", cierre: 502.8796, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "TodoRojo", clubDb: "X-Poker", sistema: "Prepago", cierre: -112.185, estado: "APLICADO" },
  { weekStart: "2026-08-24", weekEnd: "2026-08-30", agente: "Dejodita", clubDb: "X-Poker", sistema: "Prepago", cierre: -192.852, estado: "APLICADO" },

  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "F Roesca17", clubDb: "Fénix Suprema", sistema: "Win/Lose", cierre: 0.06, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "TB OTTI", clubDb: "Fénix Suprema", sistema: "Prepago", cierre: 9.413, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "F coco", clubDb: "TeamBack Suprema", sistema: "Win/Lose", cierre: 4.74, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "J Lenzo", clubDb: "TeamBack Suprema", sistema: "Prepago", cierre: -30.395, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "patoruzit0", clubDb: "TeamBack Suprema", sistema: "Win/Lose", cierre: -70.965, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "TB dementus22", clubDb: "TeamBack Suprema", sistema: "Prepago", cierre: -185.147, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "BestiaPop!", clubDb: "TeamBack GG", sistema: "Prepago", cierre: 348.424, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "daylight25", clubDb: "TeamBack GG", sistema: "Prepago", cierre: 228.726, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "El Latigo Loco", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: 2259.0467, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "El caiman", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: 1249.344, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "MacT-GG", clubDb: "TeamBack GG", sistema: "Win/Lose", cierre: 251.484, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "QueDificil", clubDb: "TeamBack GG", sistema: "Prepago", cierre: -2833.899, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "Demiurge29", clubDb: "Fénix GG", sistema: "Prepago", cierre: -9949.29, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "JereStack", clubDb: "Fénix GG", sistema: "Prepago", cierre: -654.22, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "renacapkr", clubDb: "Fénix GG", sistema: "Prepago", cierre: 179.668, estado: "APLICADO" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "MutiladorDoc", clubDb: "Tiny GG", sistema: "Prepago", cierre: 374.8599, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "Jinx Wang Chan", clubDb: "Tiny GG", sistema: "Prepago", cierre: -787.3721, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "Quintero100", clubDb: "Tiny GG", sistema: "Prepago", cierre: 346.7861, estado: "APLICADO SIN RAKEBACK" },
  { weekStart: "2026-08-31", weekEnd: "2026-09-06", agente: "Dejodita", clubDb: "X-Poker", sistema: "Prepago", cierre: -152.58, estado: "APLICADO SIN RAKEBACK" },
];

function fmt(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  console.log(
    `Modo: ${APPLY ? "APLICAR (se van a insertar cierres reconstruidos)" : "SOLO REPORTE (no se toca la base — corré con --apply para aplicar)"}\n`
  );
  console.log(`Filas a procesar: ${FILAS.length}\n`);

  let insertados = 0;
  let yaExistian = 0;
  let noEncontrados = 0;

  for (const f of FILAS) {
    const agent = await getAgentByName(f.agente);
    const club = await getClubByName(f.clubDb);
    if (!agent || !club) {
      noEncontrados++;
      console.log(`  ⚠ No encontrado en catálogo: agente="${f.agente}" (${agent ? "ok" : "FALTA"}) / club="${f.clubDb}" (${club ? "ok" : "FALTA"}) — semana ${f.weekStart}, se omite.`);
      continue;
    }

    const existing = await pool.query(
      `SELECT id FROM weekly_closings WHERE agent_id=$1 AND club_id=$2 AND week_start=$3 AND status <> 'REVERTIDO'`,
      [agent.id, club.id, f.weekStart]
    );
    if (existing.rows.length > 0) {
      yaExistian++;
      console.log(`  ${f.agente} / ${f.clubDb} / semana ${f.weekStart}: ya existe un cierre cargado, se omite.`);
      continue;
    }

    console.log(`  ${f.agente} / ${f.clubDb} / semana ${f.weekStart}: cierre reconstruido ${fmt(f.cierre)} (${f.estado})`);

    if (APPLY) {
      const system = f.sistema === "Win/Lose" ? "WIN_LOSE" : "PREPAGO";
      await pool.query(
        `INSERT INTO weekly_closings
          (id, agent_id, club_id, week_start, week_end, system, result, rake_total,
           rakeback_pct, rakeback, rebate_pct, rebate, adjusted_result, final_closing,
           rate_snapshot, rule_applied, status, observation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,0,0,0,0,$7,$7,1,'RECONSTRUIDO_SIN_DESGLOSE','APLICADO',$8)`,
        [
          newId("wc"),
          agent.id,
          club.id,
          f.weekStart,
          f.weekEnd,
          system,
          f.cierre,
          `Reconstruido desde HISTORIAL_SALDOS_AGENTES (planilla, export 10/09/2026) — estado original "${f.estado}". Solo se conoce el monto neto de la semana (final_closing); Resultado/Rake/Rakeback/Rebate NO están disponibles en la planilla para semanas posteriores al 23/08/2026, así que quedan en 0 (no representan que no hubo rake/rakeback real, es dato faltante). Este cierre NO generó ningún movimiento de ledger ni tocó el balance del agente — el saldo ya está corregido por separado vía sync:saldos.`,
        ]
      );
      insertados++;
    }
  }

  console.log("\n── Resumen ──");
  console.log(`Ya existían (omitidos): ${yaExistian}`);
  console.log(`No encontrados en el catálogo (omitidos): ${noEncontrados}`);
  if (APPLY) {
    console.log(`Insertados: ${insertados}`);
  } else {
    console.log(`\nNo se tocó la base todavía. Si tiene sentido, corré:\n  npm run cierres:reconstruir:apply`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
