// Importa el historial real de movimientos tomado (SOLO LECTURA) de la planilla
// "automatizacion clubes" (DIGIPLAYERS MANAGER) — hoja SALDOS_AGENTES (columnas L:U) y
// TRANSFERENCIAS_CLUBES — hacia nuestro propio ledger, para que el drill-down del panel
// muestre historial real en vez de aparecer vacío.
//
// IMPORTANTE — por qué esto NO cambia ningún saldo actual:
// El historial de la planilla empieza a mediados de julio 2026, pero los agentes vienen
// operando desde antes. Si simplemente "reprodujéramos" estos movimientos desde cero,
// cada saldo quedaría mal (le faltaría todo lo anterior a julio). Para evitarlo, por cada
// combinación agente+club que aparece en el historial:
//   1) Se lee el saldo ACTUAL de ese agente+club en la base (el que ya está bien, calculado
//      hasta hoy por el sistema).
//   2) Se calcula la suma neta de todos los movimientos históricos de ese agente+club.
//   3) Se inserta un movimiento "Saldo inicial (previo al historial importado)" con el monto
//      exacto que hace falta para que, sumando después todo el historial real en orden
//      cronológico, el saldo final dé EXACTAMENTE IGUAL al saldo actual de hoy.
// Resultado: el saldo de cada agente no se mueve ni un centavo, pero ahora se puede ver
// todo el desglose real que lo compone.
//
// Es SEGURO correr esto más de una vez: cada movimiento tiene una idempotencyKey estable
// (hist_mov_<idx> / hist_anchor_<agente>_<club>), así que si ya fue importado, no se duplica
// (registrarMovimiento es un no-op cuando la clave ya existe). Si necesitás corregir algo,
// usá el botón "Eliminar" en el panel (Resumen / Agentes → Historial) y volvé a correr esto.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { upsertAgent, getAgentByName, getClubByName } from "../repo/catalog.js";
import { registrarMovimiento, getBalance } from "../repo/ledger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MovRow {
  idx: number;
  fecha: string;
  agente: string;
  club: string;
  tipoInterno: string;
  tipoOriginal: string;
  aplicarA?: string;
  monto: number;
  observacion: string | null;
  medioPago: "USDT" | "EFECTIVO" | "ZELLE" | "SIN_TESORERIA";
  custodio: string | null;
}

interface DataFile {
  movimientos: MovRow[];
  transferenciasInformativas: MovRow[];
}

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, "data_historial.json"), "utf-8");
  const data: DataFile = JSON.parse(raw);
  const todas = [...data.movimientos, ...data.transferenciasInformativas];

  console.log(`Historial a importar: ${data.movimientos.length} movimientos reales + ${data.transferenciasInformativas.length} transferencias informativas.\n`);

  // 1) Catálogo: crear los agentes que aparecen en el historial y todavía no existen.
  //    Los clubes ya deberían existir todos (vienen del seed); si falta alguno, se avisa
  //    y se omiten sus movimientos en vez de inventar un club nuevo sin configurar.
  const agentIds: Record<string, string> = {};
  const clubIds: Record<string, string> = {};
  const clubesFaltantes = new Set<string>();

  for (const nombre of new Set(todas.map((m) => m.agente))) {
    let agent = await getAgentByName(nombre);
    if (!agent) {
      console.log(`  + Creando agente nuevo (no estaba en el catálogo): ${nombre}`);
      agent = await upsertAgent(nombre, "WIN_LOSE", null);
    }
    agentIds[nombre] = agent.id;
  }
  for (const nombre of new Set(todas.map((m) => m.club))) {
    const club = await getClubByName(nombre);
    if (!club) {
      clubesFaltantes.add(nombre);
      continue;
    }
    clubIds[nombre] = club.id;
  }
  if (clubesFaltantes.size > 0) {
    console.warn(`  ⚠ Clubes no encontrados en el catálogo (se omiten sus movimientos): ${[...clubesFaltantes].join(", ")}`);
  }

  const usables = todas.filter((m) => clubIds[m.club]);

  // 2) Agrupar por (agente, club) para calcular el ancla de saldo inicial de cada par.
  const grupos = new Map<string, MovRow[]>();
  for (const m of usables) {
    const key = `${m.agente}|||${m.club}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(m);
  }

  let anclasInsertadas = 0;
  let anclasOmitidas = 0;
  let movimientosInsertados = 0;
  let movimientosYaExistentes = 0;
  let errores = 0;

  for (const [key, rows] of grupos) {
    const [agenteNombre, clubNombre] = key.split("|||");
    const agentId = agentIds[agenteNombre];
    const clubId = clubIds[clubNombre];
    rows.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    const sumaHistorial = rows.reduce((s, r) => s + r.monto, 0);
    const balanceActual = await getBalance(agentId, clubId);
    const saldoActual = balanceActual ? Number(balanceActual.amount) : 0;
    const anclaMonto = saldoActual - sumaHistorial;

    const primeraFecha = new Date(rows[0].fecha);
    const fechaAncla = new Date(primeraFecha.getTime() - 24 * 60 * 60 * 1000);

    if (Math.abs(anclaMonto) >= 0.01) {
      try {
        await registrarMovimiento({
          idempotencyKey: `hist_anchor_${agentId}_${clubId}`,
          type: "AJUSTE",
          clubId,
          agentId,
          amount: anclaMonto,
          occurredAt: fechaAncla,
          paymentMethod: "SIN_TESORERIA",
          observation: `Saldo inicial (previo al historial importado desde la planilla). Ancla el saldo para que, sumando el historial real que sigue, el resultado coincida con el saldo vigente al importar (${new Date().toLocaleDateString("es-AR")}). No representa un movimiento real de dinero.`,
          createdBy: "import:historial-automatizacion",
        });
        anclasInsertadas++;
      } catch (err: any) {
        console.error(`  ✗ Error creando ancla para ${agenteNombre} / ${clubNombre}:`, err.message);
        errores++;
        continue;
      }
    } else {
      anclasOmitidas++;
    }

    for (const r of rows) {
      try {
        const result = await registrarMovimiento({
          idempotencyKey: `hist_mov_${r.idx}`,
          type: r.tipoInterno as any,
          clubId,
          agentId,
          amount: r.monto,
          occurredAt: new Date(r.fecha),
          paymentMethod: r.medioPago,
          custodian: r.custodio ?? undefined,
          observation: `[HISTÓRICO · ${r.tipoOriginal}] ${r.observacion ?? ""}`.trim(),
          createdBy: "import:historial-automatizacion",
        });
        if (result.alreadyApplied) movimientosYaExistentes++;
        else movimientosInsertados++;
      } catch (err: any) {
        console.error(`  ✗ Error importando movimiento #${r.idx} (${agenteNombre} / ${clubNombre}):`, err.message);
        errores++;
      }
    }
  }

  console.log("\n── Resumen de la importación ──");
  console.log(`Anclas de saldo inicial insertadas: ${anclasInsertadas} (omitidas por ser ~0: ${anclasOmitidas})`);
  console.log(`Movimientos históricos insertados: ${movimientosInsertados}`);
  console.log(`Movimientos ya existentes (re-ejecución, sin duplicar): ${movimientosYaExistentes}`);
  if (errores > 0) console.log(`⚠ Errores: ${errores} (revisá los mensajes de arriba)`);
  console.log("\nLos saldos actuales de cada agente/club NO cambiaron — solo se agregó el desglose histórico detrás de ellos.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
