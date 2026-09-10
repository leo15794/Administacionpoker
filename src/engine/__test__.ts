// Test de validación del motor de cierre contra casos reales documentados en la
// bitácora de la planilla (para asegurarnos de que el motor nuevo reproduce
// exactamente los mismos números que el sistema viejo antes de confiar en él).
import { calcularCierre, calcularCajeroCredito, calcularCierreBancado } from "./cierre.js";
import { calcularRodeoAgente } from "./rodeo.js";

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

// Fórmula genérica (ej. GG, 55% rakeback + 10% rebate)
// CORRECCIÓN (planilla, hoja CONFIG_CUENTAS_POR_CLUB_V3, fila de daylight25 y repetido en otras
// 4 filas de GG/Tiny, texto exacto): "TeamBack GG: rebate = 10% sobre (Win/Lose + Rake). Se
// calcula separado del rakeback." — la base del rebate es Resultado + Rake, NO el rake solo. El
// valor viejo de este test (2.217 = solo 10% del rake) venía de una lectura equivocada de un
// extracto anterior; quedó descartado al aparecer la fórmula documentada explícitamente en la
// planilla real.
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
// (result + rakeTotal) * rebatePct = (-47.02 + 22.17) * 0.10 = -2.485
assertClose(generico.rebate, -2.485, "daylight25: rebate 10% sobre (Resultado + Rake)");

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

// Módulo Rodeo (solo SupremaPoker — reglas verbatim dadas explícitamente por el usuario, memoria
// CORREGIDA a nivel agente+club tras auditoría contra la planilla real, hoja MEMORIA_RODEO):
// ejemplo simple: un jugador pierde USD 1.000, sin agente -> USD 350 de rodeo para el club.
const rodeoPierdeSinAgente = calcularRodeoAgente({
  jugadores: [{ playerExternalId: "p1", baseRodeo: 1000 }],
  memoriaAnterior: 0,
  tieneAgente: false,
});
assertClose(rodeoPierdeSinAgente.payable, 1000, "Rodeo (pierde, sin agente): payable = base completa (sin memoria)");
assertClose(rodeoPierdeSinAgente.clubShare, 350, "Rodeo (pierde, sin agente): 35% Club = 350");
assertClose(rodeoPierdeSinAgente.agentShare, 0, "Rodeo (pierde, sin agente): sin agente, 0 para agente");
assertClose(rodeoPierdeSinAgente.memoriaNueva, 0, "Rodeo (pierde, sin agente): sin memoria nueva");

// Si pertenece a un agente: USD 200 para el club + USD 150 para el agente.
const rodeoPierdeConAgente = calcularRodeoAgente({
  jugadores: [{ playerExternalId: "p2", baseRodeo: 1000 }],
  memoriaAnterior: 0,
  tieneAgente: true,
});
assertClose(rodeoPierdeConAgente.clubShare, 200, "Rodeo (pierde, con agente): 20% Club = 200");
assertClose(rodeoPierdeConAgente.agentShare, 150, "Rodeo (pierde, con agente): 15% Agente = 150");
assertClose(rodeoPierdeConAgente.memoriaNueva, 0, "Rodeo (pierde, con agente): sin memoria nueva");

// Si la semana siguiente el jugador gana USD 600, esos USD 600 pasan a la memoria (nada se reparte).
const rodeoGana = calcularRodeoAgente({
  jugadores: [{ playerExternalId: "p2", baseRodeo: -600 }],
  memoriaAnterior: 0,
  tieneAgente: true,
});
assertClose(rodeoGana.payable, 0, "Rodeo (gana): nada para repartir");
assertClose(rodeoGana.clubShare, 0, "Rodeo (gana): 0 para el club");
assertClose(rodeoGana.agentShare, 0, "Rodeo (gana): 0 para el agente");
assertClose(rodeoGana.memoriaNueva, 600, "Rodeo (gana): USD 600 pasan a memoria");

// La memoria se compensa antes de volver a generar rodeo positivo: si después pierde 1000 de
// nuevo pero arrastra 600 de memoria, el neto payable es solo 400 (no 1000).
const rodeoCompensaMemoria = calcularRodeoAgente({
  jugadores: [{ playerExternalId: "p2", baseRodeo: 1000 }],
  memoriaAnterior: 600,
  tieneAgente: true,
});
assertClose(rodeoCompensaMemoria.payable, 400, "Rodeo (compensa memoria): neto de 1000 - 600 memoria = 400");
assertClose(rodeoCompensaMemoria.clubShare, 80, "Rodeo (compensa memoria): 20% de 400 = 80 Club");
assertClose(rodeoCompensaMemoria.agentShare, 60, "Rodeo (compensa memoria): 15% de 400 = 60 Agente");
assertClose(rodeoCompensaMemoria.memoriaNueva, 0, "Rodeo (compensa memoria): memoria queda saldada");

// Memoria parcial: si pierde menos de lo que debe, la memoria baja pero no llega a repartir nada.
const rodeoMemoriaParcial = calcularRodeoAgente({
  jugadores: [{ playerExternalId: "p2", baseRodeo: 200 }],
  memoriaAnterior: 600,
  tieneAgente: true,
});
assertClose(rodeoMemoriaParcial.payable, 0, "Rodeo (memoria parcial): nada para repartir");
assertClose(rodeoMemoriaParcial.memoriaNueva, 400, "Rodeo (memoria parcial): memoria baja de 600 a 400");

// EL FIX EN SÍ: un agente con dos jugadores la misma semana — uno pierde 1000 (rodeo a favor),
// otro gana 400 (memoria en contra). Antes (por jugador) el que perdía generaba 1000 de payable
// completo sin enterarse del que ganó; ahora (por agente, como la planilla) se netean juntos:
// 1000 - 400 = 600 netos antes de repartir.
const rodeoAgenteMixto = calcularRodeoAgente({
  jugadores: [
    { playerExternalId: "gana200", baseRodeo: 1000 },
    { playerExternalId: "pierde", baseRodeo: -400 },
  ],
  memoriaAnterior: 0,
  tieneAgente: true,
});
assertClose(rodeoAgenteMixto.baseRodeoTotal, 600, "Rodeo (agente mixto): rodeo bruto neto entre jugadores = 600");
assertClose(rodeoAgenteMixto.payable, 600, "Rodeo (agente mixto): payable = 600 (no 1000, se netea entre jugadores del mismo agente)");
assertClose(rodeoAgenteMixto.agentShare, 90, "Rodeo (agente mixto): 15% de 600 = 90 Agente");

// Tiny GG (regla condicional TINY_GG_REBATE_CONDICIONAL) — auditoría 10/09/2026: esta regla NO
// se usa para liquidar a ningún agente real (ver comentario en engine/cierre.ts). Estos dos
// tests solo documentan que la rama del motor sigue funcionando igual que antes, por si algún
// día se arma una pantalla de reconciliación aparte contra el total de control del reporte. El
// cierre REAL de Tiny GG hoy usa la fórmula genérica de más abajo (ver test "Tiny GG — cierre
// real por sub-agente").
// Caso real "Tini poker.xlsx", super agente dangerfish96, semana 31/08 al 06/09/2026 —
// rakebackPct 0.70 coincide con el "Service Fee Rate" del reporte, rebatePct cargado como -0.10
// (convención GG en la base) para probar que el signo no importa.
// baseRebate = 22827.17 + 37604.90 + 8878.48 = 69310.55 >= 0 -> rebate = 0 (no se dispara).
// rakeback = 37604.90 * 0.70 = 26323.43. finalClosing = 22827.17 + 26323.43 + 0 = 49150.60
// (coincide exacto con "當週交收金額 (Weekly Settlement)" del reporte real).
const tinyGGSinDisparo = calcularCierre({
  agentId: "dangerfish96",
  clubId: "tiny",
  system: "WIN_LOSE",
  result: 22827.17,
  rakeTotal: 37604.9,
  rakebackPct: 0.7,
  rebatePct: -0.1,
  rateSnapshot: 1,
  specialRule: { key: "TINY_GG_REBATE_CONDICIONAL", bbjContribution: 8878.48 },
});
assertClose(tinyGGSinDisparo.rebate, 0, "Tiny GG (sin disparo): rebate en 0 cuando el P&L crudo da positivo");
assertClose(tinyGGSinDisparo.rakeback, 26323.43, "Tiny GG (sin disparo): rakeback 70% del rake");
assertClose(tinyGGSinDisparo.finalClosing, 49150.6, "Tiny GG (sin disparo): cierre final igual al reporte real");

// Caso inventado con disparo (no viene de un reporte real, solo prueba la rama negativa): si el
// P&L crudo antes de rake y sin jackpot da negativo, el rebate SUMA (nunca resta) el 10% de esa
// diferencia — probado con rebatePct guardado en POSITIVO para confirmar que el signo da igual.
const tinyGGConDisparo = calcularCierre({
  agentId: "test",
  clubId: "tiny",
  system: "WIN_LOSE",
  result: -50000,
  rakeTotal: 10000,
  rakebackPct: 0.7,
  rebatePct: 0.1,
  rateSnapshot: 1,
  specialRule: { key: "TINY_GG_REBATE_CONDICIONAL", bbjContribution: 2000 },
});
// baseRebate = -50000 + 10000 + 2000 = -38000 -> rebate = 38000 * 0.10 = 3800 (suma).
assertClose(tinyGGConDisparo.rebate, 3800, "Tiny GG (con disparo): rebate suma 10% del P&L crudo negativo");

// Tiny GG — cierre real por sub-agente (fórmula genérica, sin specialRule): caso real "Tini
// poker.xlsx", sub-agente MutiladorDoc bajo el super agente dangerfish96, misma semana. Estos
// números salen de sumar sus 2 jugadores en la hoja "3.玩家數據" (24470.59 + -9227.81 =
// 15242.78 de resultado; 12241.64 + 5812.91 = 18054.55 de rake) y coinciden al centavo con la
// fila de MutiladorDoc en la hoja "2.代理數據統計" — confirma que el importador nuevo agrupa
// bien por sub-agente (ver engine/importTinyGG.ts, repo/importsTinyGG.ts).
const tinyGGSubAgenteReal = calcularCierre({
  agentId: "MutiladorDoc",
  clubId: "tiny-gg",
  system: "WIN_LOSE",
  result: 15242.78,
  rakeTotal: 18054.55,
  rakebackPct: 0.7,
  rebatePct: -0.1,
  rateSnapshot: 1,
});
if (tinyGGSubAgenteReal.ruleApplied !== null) {
  console.error(`❌ Tiny GG (sub-agente real): esperaba ruleApplied null, obtuve ${tinyGGSubAgenteReal.ruleApplied}`);
  process.exitCode = 1;
} else {
  console.log("✅ Tiny GG (sub-agente real): no usa ninguna regla especial, fórmula genérica");
}
assertClose(tinyGGSubAgenteReal.rebate, -3329.733, "Tiny GG (sub-agente real): rebate = (resultado+rake) × -10%");
assertClose(tinyGGSubAgenteReal.rakeback, 12638.185, "Tiny GG (sub-agente real): rakeback = rake × 70%");
assertClose(tinyGGSubAgenteReal.finalClosing, 24551.232, "Tiny GG (sub-agente real): cierre final = resultado + rakeback + rebate");

console.log("\nTest de motor de cierre finalizado.");
