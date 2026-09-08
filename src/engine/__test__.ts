// Test de validación del motor de cierre contra casos reales documentados en la
// bitácora de la planilla (para asegurarnos de que el motor nuevo reproduce
// exactamente los mismos números que el sistema viejo antes de confiar en él).
import { calcularCierre, calcularCajeroCredito, calcularCierreBancado } from "./cierre.js";

function assertClose(actual: number, expected: number, label: string) {
  const diff = Math.abs(actual - expected);
  if (diff > 0.01) {
    console.error(`❌ ${label}: esperado ${expected}, obtuve ${actual}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ ${label}: ${actual} (esperado ${expected})`);
  }
}

// Caso BIT-035 (Cajero UY, real, documentado 18/08/2026):
// deuda 1.700,00 + cargas 450,00 - rakeback 312,56 - cobro 1.552,00 = 285,44 que Cajero UY debe.
const cajero = calcularCajeroCredito({
  deudaAnterior: 1700.0,
  cargas: 450.0,
  rakeback: 312.56,
  cobrosUsdt: 1552.0,
});
assertClose(cajero.deudaNueva, 285.44, "BIT-035 Cajero UY: deuda final");
assertClose(cajero.saldoAFavorAgente, 0, "BIT-035 Cajero UY: sin saldo a favor (no excedió deuda)");

// Caso de exceso de pago: si el cobro fuera mayor a la deuda, el excedente pasa a
// saldo a favor del agente (regla explícita de BIT-035), nunca se infiere automáticamente.
const cajeroExceso = calcularCajeroCredito({
  deudaAnterior: 200,
  cargas: 0,
  rakeback: 0,
  cobrosUsdt: 350,
});
assertClose(cajeroExceso.deudaNueva, 0, "Cajero UY exceso: deuda queda en 0");
assertClose(cajeroExceso.saldoAFavorAgente, 150, "Cajero UY exceso: saldo a favor del agente");

// Regla Manzur (BIT-068): SIEMPRE resultado + 75% del rake total, nunca la fórmula genérica.
const manzur = calcularCierre({
  agentId: "manzur",
  clubId: "fenix-gg",
  system: "WIN_LOSE",
  result: -4744.83,
  rakeTotal: 6000, // valor ilustrativo: no tenemos el rake exacto de esa semana en el extracto
  rakebackPct: 0.7, // no debe usarse: la regla especial la ignora
  rebatePct: 0,
  rateSnapshot: 1,
  specialRule: { key: "MANZUR_75_RAKE", pctRake: 0.75 },
});
assertClose(manzur.rakeback, 4500, "Manzur: 75% del rake total (ignora rakebackPct genérico)");
assertClose(manzur.finalClosing, -244.83, "Manzur: cierre final = resultado + 75% rake");
if (manzur.ruleApplied !== "MANZUR_75_RAKE") {
  console.error("❌ Manzur: no quedó trazado ruleApplied = MANZUR_75_RAKE");
  process.exitCode = 1;
} else {
  console.log("✅ Manzur: ruleApplied trazado correctamente");
}

// Fórmula genérica (ej. GG, 70% rakeback + 10% rebate — valores reales relevados del sistema actual)
const generico = calcularCierre({
  agentId: "daylight25",
  clubId: "gg",
  system: "PREPAGO",
  result: -47.02,
  rakeTotal: 22.17,
  rakebackPct: 0.55, // % RB Fénix GG relevado para daylight25 en su cuenta automatizada
  rebatePct: 0.10,
  rateSnapshot: 1,
});
// Del extracto real de "daylight25": Rebate GG = 2,49 (10% de 22,17 = 2,217 ~ redondeo real de la planilla)
assertClose(generico.rebate, 2.217, "daylight25: rebate 10% del rake");

// Módulo Bancado (caso real Matías Fontal, relevado explícitamente en esta conversación):
// caja inicial 300, gana 100 en las mesas, genera 200 de rake (30% = 60 de rakeback).
// Ganancia del bancado: 50 de la mesa + 60 de rakeback = 110. Ganancia DigiPlayers: 50 de la mesa.
const bancadoGanador = calcularCierreBancado({
  mesaResult: 100,
  rakeTotal: 200,
  rakebackPct: 0.3,
  agentSharePct: 0.5,
  deudaAnterior: 0,
});
assertClose(bancadoGanador.digiplayersShare, 50, "Bancado (mesa ganadora): ganancia DigiPlayers");
assertClose(bancadoGanador.finalClosing, 110, "Bancado (mesa ganadora): acreditado al bancado (50 mesa + 60 rakeback)");
assertClose(bancadoGanador.deudaNueva, 0, "Bancado (mesa ganadora): sin memoria pendiente");

// Caja inicial 300, pierde 100 en las mesas, genera 100 de rake (30% = 30 de rakeback).
// El rakeback (30) cubre parte de la pérdida (100) y queda con una memoria de 70.
const bancadoPerdedorSinCubrir = calcularCierreBancado({
  mesaResult: -100,
  rakeTotal: 100,
  rakebackPct: 0.3,
  agentSharePct: 0.5,
  deudaAnterior: 0,
});
assertClose(bancadoPerdedorSinCubrir.digiplayersShare, 0, "Bancado (mesa negativa, no cubre): sin ganancia DigiPlayers");
assertClose(bancadoPerdedorSinCubrir.finalClosing, 0, "Bancado (mesa negativa, no cubre): nada acreditado al bancado");
assertClose(bancadoPerdedorSinCubrir.deudaNueva, 70, "Bancado (mesa negativa, no cubre): memoria de 70");

// Caja inicial 300, pierde 20, genera 100 de rake (30% = 30 de rakeback). El rakeback cubre
// los 20 de pérdida y sobran 10, que quedan 100% para el bancado (no se reparte con DigiPlayers).
const bancadoPerdedorCubreYSobra = calcularCierreBancado({
  mesaResult: -20,
  rakeTotal: 100,
  rakebackPct: 0.3,
  agentSharePct: 0.5,
  deudaAnterior: 0,
});
assertClose(bancadoPerdedorCubreYSobra.digiplayersShare, 0, "Bancado (mesa negativa, sobra): sin ganancia DigiPlayers");
assertClose(bancadoPerdedorCubreYSobra.finalClosing, 10, "Bancado (mesa negativa, sobra): sobrante 100% del bancado");
assertClose(bancadoPerdedorCubreYSobra.deudaNueva, 0, "Bancado (mesa negativa, sobra): memoria queda en 0");

// Memoria arrastrada (deuda eterna): si viene con 70 de memoria y esta semana genera menos de
// eso, la memoria baja pero no se acredita nada al bancado.
const bancadoConMemoriaParcial = calcularCierreBancado({
  mesaResult: 40,
  rakeTotal: 100,
  rakebackPct: 0.3,
  agentSharePct: 0.5,
  deudaAnterior: 70,
});
// bancadoOwnAmount = 40*0.5 + 30 = 50; neto tras memoria = 50 - 70 = -20 -> memoria queda en 20.
assertClose(bancadoConMemoriaParcial.finalClosing, 0, "Bancado (memoria parcial): nada acreditado, sigue debiendo");
assertClose(bancadoConMemoriaParcial.deudaNueva, 20, "Bancado (memoria parcial): memoria baja de 70 a 20");

console.log("\nTest de motor de cierre finalizado.");
