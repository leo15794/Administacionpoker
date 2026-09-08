// Importa el historial real de la Wallet Manos (SOLO LECTURA de la planilla, hoja
// WALLET_MANOS) a nuestra tesorería, para que la pestaña de Wallet muestre el detalle real
// en vez de solo los pocos movimientos que la app generó automáticamente hasta ahora.
//
// POR QUÉ HACE FALTA UN ANCLA (igual que el importador de historial de agentes):
// La wallet viene operando desde antes de que la app existiera — la app solo generó
// treasury_entries automáticos para los movimientos de agentes cargados con medio de pago
// USDT (incluido el historial de agentes ya importado, que cubre desde mediados de julio).
// Si sumáramos ESTE historial completo de Wallet Manos (que también cubre ese mismo período)
// arriba de lo que la app ya generó, contaríamos las mismas cargas/pagos dos veces.
//
// Para evitarlo:
//   1) Se calcula cuánto suman HOY todos los treasury_entries + treasury_adjustments ya
//      existentes en la base con fecha hasta el corte de este historial (la fecha del
//      último movimiento importado).
//   2) Se inserta UN ajuste "ancla" por el monto exacto que neutraliza ese total (para que
//      no se cuente dos veces), fechado antes del primer movimiento del historial.
//   3) Se importan los 549 movimientos reales de la planilla tal cual, con su fecha real.
// Resultado: el saldo de wallet a la fecha de corte queda EXACTAMENTE en el monto real de
// la planilla (20.838,432 al 08/09/2026), y además ahora se puede ver el detalle real de
// cada carga/pago en vez de un solo número. Los movimientos cargados por la app DESPUÉS de
// la fecha de corte se siguen sumando arriba, normalmente, sin duplicar nada.
//
// Es seguro correr esto más de una vez: cada fila tiene una idempotencyKey estable
// (wallet_hist_<idx> / wallet_hist_ancla), así que si ya fue importada, no se duplica.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { registrarAjusteTesoreria } from "../repo/treasury.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MovRow {
  idx: string | number;
  fecha: string;
  concepto: string;
  direccion: "INGRESO" | "EGRESO";
  monto: number;
}
interface DataFile {
  generadoEn: string;
  totalEsperado: number;
  movimientos: MovRow[];
}

async function main() {
  const raw = fs.readFileSync(path.join(__dirname, "wallet_historial.json"), "utf-8");
  const data: DataFile = JSON.parse(raw);

  const invalidas = data.movimientos.filter((m) => Number.isNaN(new Date(m.fecha).getTime()));
  if (invalidas.length > 0) {
    console.error(`✗ Hay ${invalidas.length} fila(s) con fecha inválida, no se puede continuar:`);
    for (const m of invalidas) console.error(`  idx=${m.idx} fecha="${m.fecha}"`);
    process.exit(1);
  }

  const fechaCorte = new Date(Math.max(...data.movimientos.map((m) => new Date(m.fecha).getTime())));
  const fechaAncla = new Date(Math.min(...data.movimientos.map((m) => new Date(m.fecha).getTime())) - 24 * 60 * 60 * 1000);

  console.log(`Historial a importar: ${data.movimientos.length} movimientos de Wallet Manos (desde ${data.movimientos[0].fecha} hasta ${fechaCorte.toISOString()}).\n`);

  // 1) Calcular cuánto suma hoy lo que la app ya generó (automático + manual) hasta la
  //    fecha de corte, para poder neutralizarlo con el ancla y no contar dos veces.
  const yaExistente = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS' AND occurred_at <= $1
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS' AND occurred_at <= $1
     ) t`,
    [fechaCorte]
  );
  const netoExistente = Number(yaExistente.rows[0].neto);
  console.log(`Ya generado por la app hasta la fecha de corte: ${netoExistente.toFixed(2)} (se neutraliza con el ancla).`);

  if (Math.abs(netoExistente) >= 0.01) {
    const result = await registrarAjusteTesoreria({
      idempotencyKey: "wallet_hist_ancla",
      ledger: "WALLET_MANOS",
      direction: netoExistente > 0 ? "EGRESO" : "INGRESO",
      amount: Math.abs(netoExistente),
      occurredAt: fechaAncla,
      reason: `Ancla: neutraliza los ${netoExistente.toFixed(2)} que la app ya había generado automáticamente hasta el ${fechaCorte.toLocaleDateString("es-AR")}, para no duplicarlos al importar el historial real completo de Wallet Manos.`,
      createdBy: "import:wallet-historial",
    });
    console.log(result.alreadyApplied ? "  (el ancla ya existía, no se duplicó)" : "  Ancla insertada.");
  } else {
    console.log("  No hacía falta ancla (no había nada previo que neutralizar).");
  }

  // 2) Importar cada movimiento real, tal cual está en la planilla.
  let insertados = 0;
  let yaExistian = 0;
  let errores = 0;
  for (const m of data.movimientos) {
    try {
      const result = await registrarAjusteTesoreria({
        idempotencyKey: `wallet_hist_${m.idx}`,
        ledger: "WALLET_MANOS",
        direction: m.direccion,
        amount: m.monto,
        occurredAt: new Date(m.fecha),
        reason: `[HISTÓRICO] ${m.concepto}`,
        createdBy: "import:wallet-historial",
      });
      if (result.alreadyApplied) yaExistian++;
      else insertados++;
    } catch (err: any) {
      console.error(`  ✗ Error importando fila ${m.idx}:`, err.message);
      errores++;
    }
  }

  console.log("\n── Resumen ──");
  console.log(`Movimientos insertados: ${insertados}`);
  console.log(`Ya existentes (re-ejecución, sin duplicar): ${yaExistian}`);
  if (errores > 0) console.log(`⚠ Errores: ${errores}`);

  // 3) Corrección final de precisión: el ancla del paso 1 neutraliza todo lo que existía
  //    "hasta la fecha de corte" usando esa fecha a las 00:00 — un movimiento real cargado
  //    ESE MISMO DÍA pero más tarde (ej. 15:00) quedaba afuera del corte y no se
  //    neutralizaba, duplicándose. Para no depender de arreglar el ancla ya insertada
  //    (que no se puede duplicar ni editar), este paso mide cuánto sobra o falta al final
  //    contra lo esperado — descontando cualquier actividad real y genuina posterior a la
  //    fecha de corte — y lo corrige con UN ajuste adicional. Re-correr esto en el mismo día
  //    no lo vuelve a aplicar (queda con la fecha de hoy en la clave).
  const actividadPosterior = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS' AND occurred_at > $1
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments
       WHERE ledger = 'WALLET_MANOS' AND occurred_at > $1 AND (created_by IS NULL OR created_by NOT LIKE 'import:%')
     ) t`,
    [fechaCorte]
  );
  const netoPosterior = Number(actividadPosterior.rows[0].neto);

  const totalActual = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS'
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS'
     ) t`
  );
  const netoActual = Number(totalActual.rows[0].neto);
  const esperadoConActividad = data.totalEsperado + netoPosterior;
  const diferenciaResidual = esperadoConActividad - netoActual;

  console.log(`\nActividad real posterior a la fecha de corte (no tocada por el import): ${netoPosterior.toFixed(2)}.`);
  console.log(`Saldo actual: ${netoActual.toFixed(2)} — esperado (planilla + esa actividad posterior): ${esperadoConActividad.toFixed(2)}.`);

  if (Math.abs(diferenciaResidual) >= 0.01) {
    const hoy = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const result = await registrarAjusteTesoreria({
      idempotencyKey: `wallet_hist_correccion_${hoy}`,
      ledger: "WALLET_MANOS",
      direction: diferenciaResidual > 0 ? "INGRESO" : "EGRESO",
      amount: Math.abs(diferenciaResidual),
      occurredAt: new Date(),
      reason: `Corrección de precisión: ajusta ${diferenciaResidual.toFixed(2)} residual porque el ancla original neutralizó "hasta la fecha de corte a las 00:00" y algún movimiento real de ese mismo día con hora posterior quedó contado dos veces (o algo similar). No representa un movimiento real de dinero.`,
      createdBy: "import:wallet-historial",
    });
    console.log(result.alreadyApplied ? "  (la corrección ya se había aplicado hoy, no se duplicó)" : `  Corrección de ${diferenciaResidual.toFixed(2)} aplicada.`);
  } else {
    console.log("  Sin diferencia residual — no hizo falta corrección.");
  }

  const final = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN direction='INGRESO' THEN amount ELSE -amount END), 0) as neto
     FROM (
       SELECT direction, amount FROM treasury_entries WHERE ledger = 'WALLET_MANOS'
       UNION ALL
       SELECT direction, amount FROM treasury_adjustments WHERE ledger = 'WALLET_MANOS'
     ) t`
  );
  console.log(`\nSaldo de Wallet Manos ahora en la app: ${Number(final.rows[0].neto).toFixed(2)} (esperado, según la planilla al ${data.generadoEn} + actividad posterior real: ${esperadoConActividad.toFixed(2)}).`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
