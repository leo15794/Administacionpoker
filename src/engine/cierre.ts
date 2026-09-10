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
  /** "Rodeo" (SupremaPoker, "solamente para Suprema" — pedido explícito del usuario): la parte
   * que le toca al agente, YA calculada por repo/rodeo.ts a partir de la memoria por jugador
   * (ver engine/rodeo.ts para las reglas de reparto y memoria). Este motor solo la suma directo
   * al cierre final — nunca la multiplica por ningún % ni la desvía a un supervisor (a diferencia
   * del rebate), y aplica igual aunque el agente tenga una regla especial vigente. Por defecto 0
   * para cualquier cierre que no venga de una importación Suprema. */
  rodeo?: number;
}

export type SpecialRule =
  | { key: "MANZUR_75_RAKE"; pctRake: number } // resultado + pctRake * rakeTotal, ignora rakebackPct genérico
  | { key: "CAJERO_CREDITO"; deudaAnterior: number } // cargas a crédito: cobros van primero contra deuda
  // Club "Tiny" (plataforma GG Poker, reporte "Super Agent Report" propio, un archivo por
  // super agente — ver engine/importTinyGG.ts): el rebate NO es un % fijo siempre aplicado
  // como TeamBack GG — solo se dispara cuando el "P&L crudo antes de rake y sin jackpot" del
  // super agente completo da negativo esa semana. bbjContribution = fee de contribución a Bad
  // Beat Jackpot de TODOS sus jugadores esa semana (viene del importador, 0 si no hubo).
  // Fórmula confirmada por el usuario y verificada exacta contra un reporte real (semana
  // 31/08-06/09/2026, super agente dangerfish96): ver cierre completo abajo.
  | { key: "TINY_GG_REBATE_CONDICIONAL"; bbjContribution: number };

export interface ClosingResult {
  result: number;
  rakeTotal: number;
  rakebackPct: number;
  rakeback: number;
  rebatePct: number;
  rebate: number;
  adjustedResult: number;
  rodeo: number;
  finalClosing: number;
  ruleApplied: string | null;
  /** Solo seteado por TINY_GG_REBATE_CONDICIONAL: Resultado + Rake + Fee de Bad Beat Jackpot —
   * si da negativo se disparó el rebate, si da >= 0 el rebate quedó en 0 esta semana. Se expone
   * para que la UI pueda mostrar "por qué" sin tener que recalcularlo del lado del cliente. */
  tinyBaseRebate?: number;
}

/**
 * Calcula un cierre semanal para un agente en un club.
 * Regla de oro (guía operativa original): "no modificar saldos para hacerlos cuadrar" —
 * este motor es puro (misma entrada -> misma salida), no debe depender de estado mutable externo.
 */
export function calcularCierre(input: ClosingInput): ClosingResult {
  const rodeo = input.rodeo ?? 0;

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
      rodeo,
      finalClosing: adjustedResult + rodeo,
      ruleApplied: "MANZUR_75_RAKE",
    };
  }

  if (input.specialRule?.key === "TINY_GG_REBATE_CONDICIONAL") {
    // Ver comentario del SpecialRule más arriba y engine/importTinyGG.ts para el detalle
    // completo. Nunca resta: cuando el P&L crudo da negativo, el rebate SUMA (Math.abs del %
    // configurado) para cubrir esa parte — a diferencia de TeamBack GG, acá no importa con qué
    // signo esté cargado el % del deal en la base.
    const rakeback = input.rakeTotal * input.rakebackPct;
    const bbj = input.specialRule.bbjContribution;
    const tinyBaseRebate = input.result + input.rakeTotal + bbj;
    const rebate = tinyBaseRebate < 0 ? -tinyBaseRebate * Math.abs(input.rebatePct) : 0;
    const adjustedResult = input.result + rakeback + rebate;
    return {
      result: input.result,
      rakeTotal: input.rakeTotal,
      rakebackPct: input.rakebackPct,
      rakeback,
      rebatePct: input.rebatePct,
      rebate,
      adjustedResult,
      rodeo,
      finalClosing: adjustedResult + rodeo,
      ruleApplied: "TINY_GG_REBATE_CONDICIONAL",
      tinyBaseRebate,
    };
  }

  // Fórmula genérica: resultado ajustado = resultado + rakeback + rebate
  // El rebate NO se calcula solo sobre el rake: la planilla original (CONFIG_CUENTAS_POR_CLUB_V3,
  // confirmado también en RESUMEN_TINY!D2 = Resultado+Rake = "Base Rebate Agente") define la base
  // del rebate como Resultado + Rake Total, no el rake solo. Usar solo rakeTotal (como estaba
  // antes) le pagaba de menos al agente cuando el resultado es negativo (lo normal, porque un
  // resultado negativo del jugador es lo que genera rake) y de más cuando es muy positivo.
  const rakeback = input.rakeTotal * input.rakebackPct;
  const rebate = (input.result + input.rakeTotal) * input.rebatePct;
  const adjustedResult = input.result + rakeback + rebate;

  return {
    result: input.result,
    rakeTotal: input.rakeTotal,
    rakebackPct: input.rakebackPct,
    rakeback,
    rebatePct: input.rebatePct,
    rebate,
    adjustedResult,
    rodeo,
    finalClosing: adjustedResult + rodeo,
    ruleApplied: null,
  };
}

// ============ Módulo Bancado (punto 6 del documento de rediseño) ============
// Regla real (caso Matías Fontal, relevada explícitamente): el bancado banca una mesa con una
// caja inicial. Lo que pasa en la mesa es EXACTAMENTE al revés de un agente normal: si el
// bancado gana en la mesa, ese resultado se reparte 50/50 con DigiPlayers (la parte de
// DigiPlayers queda como fichas en el club, no se acredita a ningún agente del sistema). El
// rakeback (% configurable del rake generado) es SIEMPRE 100% del bancado, nunca se reparte:
// si la mesa dio negativa, el rakeback cubre esa pérdida primero; si no alcanza, la diferencia
// queda como "memoria" — una deuda que NUNCA prescribe (se arrastra semana a semana) y que las
// próximas semanas positivas del bancado (su parte de mesa + su rakeback) tienen que cubrir
// ANTES de que se le acredite nada. Si la mesa dio negativa pero el rakeback la cubre y sobra,
// ese sobrante es 100% del bancado (nunca se reparte con DigiPlayers — el reparto solo aplica
// sobre una mesa que ganó, no sobre una recuperación con rakeback).
export interface BancadoInput {
  mesaResult: number; // resultado del bancado en la mesa esa semana (positivo = ganó, negativo = perdió)
  rakeTotal: number;
  rakebackPct: number; // 0..1, 100% para el bancado
  agentSharePct: number; // 0..1, % de la mesa (si es positiva) que le corresponde al bancado; el resto es de DigiPlayers
  deudaAnterior: number; // "memoria" arrastrada de semanas anteriores (0 si no hay)
}

export interface BancadoResult {
  mesaResult: number;
  rakeTotal: number;
  rakeback: number;
  digiplayersShare: number; // informativo: fichas que quedan en el club, no se acredita a ningún agente
  bancadoShareMesa: number; // parte de la mesa que le toca al bancado (0 si la mesa fue negativa)
  bancadoOwnAmount: number; // lo que generó el bancado esta semana, antes de aplicar la memoria
  deudaAnterior: number;
  deudaNueva: number;
  finalClosing: number; // lo que efectivamente se acredita al saldo del bancado esta semana (0 si quedó cubierto por memoria)
}

export function calcularCierreBancado(input: BancadoInput): BancadoResult {
  const rakeback = input.rakeTotal * input.rakebackPct;
  const mesaPositiva = input.mesaResult >= 0;

  const digiplayersShare = mesaPositiva ? input.mesaResult * (1 - input.agentSharePct) : 0;
  const bancadoShareMesa = mesaPositiva ? input.mesaResult * input.agentSharePct : 0;
  // Si la mesa fue negativa, el bancado "genera" (mesaResult + rakeback): el rakeback cubre la
  // pérdida total o parcialmente. Si fue positiva, genera su parte de la mesa + el rakeback entero.
  const bancadoOwnAmount = mesaPositiva ? bancadoShareMesa + rakeback : input.mesaResult + rakeback;

  const netTrasMemoria = bancadoOwnAmount - input.deudaAnterior;
  const finalClosing = netTrasMemoria >= 0 ? netTrasMemoria : 0;
  const deudaNueva = netTrasMemoria >= 0 ? 0 : -netTrasMemoria;

  return {
    mesaResult: input.mesaResult,
    rakeTotal: input.rakeTotal,
    rakeback,
    digiplayersShare,
    bancadoShareMesa,
    bancadoOwnAmount,
    deudaAnterior: input.deudaAnterior,
    deudaNueva,
    finalClosing,
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
