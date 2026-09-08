// Motor de cierre semanal.
// Principio (BIT-068 y reglas de la bitácora): las reglas especiales de un agente
// se resuelven ANTES que la fórmula genérica, y quedan versionadas por vigencia.
// Nunca hardcodeadas "sueltas" en el código de negocio general.

export type SettlementSystem = "PREPAGO" | "WIN_LOSE";

export interface ClosingInput {
  agentId: string;
  clubId: string;
  system: SettlementSystem;
  result: number; // resultado del jugador (win/lose) en USD, ya convertido con el rate de la semana
  rakeTotal: number; // rake total generado en USD
  rakebackPct: number; // 0..1
  rebatePct: number; // 0..1
  rateSnapshot: number;
  specialRule?: SpecialRule | null;
}

export type SpecialRule =
  | { key: "MANZUR_75_RAKE"; pctRake: number } // resultado + pctRake * rakeTotal, ignora rakebackPct genérico
  | { key: "CAJERO_CREDITO"; deudaAnterior: number }; // cargas a crédito: cobros van primero contra deuda

export interface ClosingResult {
  result: number;
  rakeTotal: number;
  rakebackPct: number;
  rakeback: number;
  rebatePct: number;
  rebate: number;
  adjustedResult: number;
  finalClosing: number;
  ruleApplied: string | null;
}

/**
 * Calcula un cierre semanal para un agente en un club.
 * Regla de oro (guía operativa original): "no modificar saldos para hacerlos cuadrar" —
 * este motor es puro (misma entrada -> misma salida), no debe depender de estado mutable externo.
 */
export function calcularCierre(input: ClosingInput): ClosingResult {
  if (input.specialRule?.key === "MANZUR_75_RAKE") {
    // Regla crítica documentada (BIT-068): Manzur en Fénix GG se liquida SIEMPRE
    // como Resultado + 75% del rake total del proveedor. Nunca usar rakebackPct genérico.
    const rakeback = input.rakeTotal * input.specialRule.pctRake;
    const adjustedResult = input.result + rakeback;
    return {
      result: input.result,
      rakeTotal: input.rakeTotal,
      rakebackPct: input.specialRule.pctRake,
      rakeback,
      rebatePct: 0,
      rebate: 0,
      adjustedResult,
      finalClosing: adjustedResult,
      ruleApplied: "MANZUR_75_RAKE",
    };
  }

  // Fórmula genérica: resultado ajustado = resultado + rakeback + rebate
  const rakeback = input.rakeTotal * input.rakebackPct;
  const rebate = input.rakeTotal * input.rebatePct;
  const adjustedResult = input.result + rakeback + rebate;

  return {
    result: input.result,
    rakeTotal: input.rakeTotal,
    rakebackPct: input.rakebackPct,
    rakeback,
    rebatePct: input.rebatePct,
    rebate,
    adjustedResult,
    finalClosing: adjustedResult,
    ruleApplied: null,
  };
}

export interface CajeroCreditoInput {
  deudaAnterior: number; // deuda arrastrada (positivo = agente nos debe)
  cargas: number; // nuevas cargas a crédito de la semana (aumentan deuda)
  rakeback: number; // reduce deuda
  cobrosUsdt: number; // reduce deuda; si excede, el excedente es saldo a favor del agente
}

export interface CajeroCreditoResult {
  deudaNueva: number; // positivo = agente debe, 0 si se saldó
  saldoAFavorAgente: number; // solo > 0 si el cobro excedió la deuda pendiente
}

/**
 * Regla Cajero UY (BIT-035): "cargas a crédito" -> las cargas aumentan deuda, el
 * rakeback y los cobros en USDT la reducen. Un cobro solo genera saldo a favor del
 * agente si excede la deuda pendiente. Nunca inferir saldo a favor sin verificar exceso de pago.
 */
export function calcularCajeroCredito(input: CajeroCreditoInput): CajeroCreditoResult {
  const deudaTrasCargas = input.deudaAnterior + input.cargas;
  const deudaTrasRakeback = deudaTrasCargas - input.rakeback;
  const deudaTrasCobro = deudaTrasRakeback - input.cobrosUsdt;

  if (deudaTrasCobro >= 0) {
    return { deudaNueva: deudaTrasCobro, saldoAFavorAgente: 0 };
  }
  // el cobro excedió la deuda pendiente: el excedente es saldo a favor del agente
  return { deudaNueva: 0, saldoAFavorAgente: -deudaTrasCobro };
}
