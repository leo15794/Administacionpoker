// Motor de cálculo de "Bancado — Contratos", regla REGLA_BANCADO_V1 (pedido Leo 02/10/2026,
// caso Matías con contrato nuevo). Funciones puras, sin acceso a base -- repo/bancadoContratos.ts
// las usa tanto para previsualizar (proyección mientras el período está abierto) como para
// liquidar de verdad (cierre mensual / split extraordinario), misma cuenta siempre.
//
// La regla RMF (la fórmula vieja, reutilizada tal cual para contratos que elijan esa regla) NO
// vive acá -- repo/bancadoContratos.ts importa calcularCierreBancado directo de engine/cierre.ts,
// sin duplicar código.
//
// ============================================================================================
// CÓMO SE EVITA CONTAR DOS VECES UN SPLIT EXTRAORDINARIO (sección 18 del documento de Leo) --
// esto es la parte más delicada de todo el módulo, documentado en detalle porque si se rompe,
// se reparte plata que ya se había repartido antes.
//
// Cada período tiene un "pendiente a procesar" en cualquier momento:
//
//   pendiente = resultadoDealAcumulado(hasta ahora) - memoriaYaAplicadaEnEventosPrevios
//                                                    - resultadoYaDistribuidoEnEventosPrevios
//
// (nota: "memoriaYaAplicadaEnEventosPrevios" = memoriaInicialPeriodo - memoriaActual, ambos
//  números ya los tiene el período guardado -- no hace falta sumarlo aparte)
//
// Sobre ese "pendiente" se corre SIEMPRE la misma función (calcularRecuperacionYSplit): compara
// contra la memoria que queda (memoriaActual, YA neta de lo que se haya recuperado en eventos
// previos) y reparte el resto. Esto vale igual para:
//   - la PROYECCIÓN mientras el mes está abierto (sección 10/11): memoriaActual = memoria del
//     período tal cual está guardada ahora (si nunca hubo un extraordinario, es la memoria
//     inicial);
//   - el CIERRE MENSUAL (secciones 12-16): resultadoDealAcumulado = el total de TODO el mes;
//   - un SPLIT EXTRAORDINARIO (sección 17): a diferencia de los otros dos, "ganancia disponible"
//     ahí es un monto que TeamBack autoriza a mano (no se deriva de los parciales) -- ver
//     calcularSplitExtraordinario más abajo.
//
// Verificado contra TODOS los ejemplos numéricos del documento de Leo (secciones 11, 13, 15,
// 17, 20) antes de escribir una sola línea de repo/rutas -- cualquier cambio a esta lógica tiene
// que volver a pasar esos mismos números.
// ============================================================================================

export interface BancadoV1SplitConfig {
  splitJugadorPct: number; // 0..1
  splitTeambackPct: number; // 0..1
}

export interface BancadoV1Config extends BancadoV1SplitConfig {
  rakeDealPct: number; // 0..1, ej 0.60 -- sección 4
  rakeTeambackDirectoPct: number; // 0..1, ej 0.20 -- sección 5, siempre de TeamBack, nunca se reparte ni entra a memoria
}

export type ModoMemoria = "AUTOMATICO" | "PARCIAL_MANUAL";

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---------- Sección 7: cierre parcial semanal (NUNCA liquida, NUNCA toca memoria) ----------
export interface ParcialSemanalInput {
  resultadoMesas: number;
  rakeBruto: number;
  ajuste?: number; // se suma directo al resultado deal de la semana (sección 7: "ajustes si existieran")
}

export interface ParcialSemanalResult {
  rakeDealSemana: number;
  resultadoDealSemana: number;
  rakeTeambackSemana: number;
}

export function calcularParcialSemanal(cfg: BancadoV1Config, input: ParcialSemanalInput): ParcialSemanalResult {
  const rakeDealSemana = input.rakeBruto * cfg.rakeDealPct;
  const resultadoDealSemana = input.resultadoMesas + rakeDealSemana + (input.ajuste ?? 0);
  const rakeTeambackSemana = input.rakeBruto * cfg.rakeTeambackDirectoPct;
  return {
    rakeDealSemana: redondear(rakeDealSemana),
    resultadoDealSemana: redondear(resultadoDealSemana),
    rakeTeambackSemana: redondear(rakeTeambackSemana),
  };
}

// ---------- Sección 16: split simple sobre una base ya liberada ----------
export function calcularSplit(cfg: BancadoV1SplitConfig, resultadoParaSplit: number): { splitJugador: number; splitTeamback: number } {
  if (resultadoParaSplit <= 0) return { splitJugador: 0, splitTeamback: 0 };
  return {
    splitJugador: redondear(resultadoParaSplit * cfg.splitJugadorPct),
    splitTeamback: redondear(resultadoParaSplit * cfg.splitTeambackPct),
  };
}

// ---------- Núcleo: recuperación de memoria + split, sobre un "pendiente" ya neto de lo que se
// haya resuelto antes en el período (ver comentario grande arriba). Sirve para la proyección
// (modoMemoria siempre AUTOMATICO, es solo informativo) y para el cierre mensual (modoMemoria =
// el configurado en el período). ----------
export interface RecuperacionYSplitInput {
  pendiente: number; // resultadoDealAcumulado - lo ya aplicado a memoria - lo ya distribuido en el período
  memoriaActual: number; // memoria que queda AHORA (ya neta de eventos previos del período)
  modoMemoria: ModoMemoria;
  memoriaAplicadaManual?: number; // obligatorio si modoMemoria=PARCIAL_MANUAL y pendiente>0
  splitCfg: BancadoV1SplitConfig;
}

export interface RecuperacionYSplitResult {
  recuperacionMaxima: number;
  memoriaAplicada: number;
  memoriaFinal: number;
  resultadoParaSplit: number;
  splitJugador: number;
  splitTeamback: number;
}

export function calcularRecuperacionYSplit(input: RecuperacionYSplitInput): RecuperacionYSplitResult {
  if (input.memoriaActual < 0) throw new Error("La memoria nunca puede ser negativa (regla de seguridad, sección 3/33).");

  // Sección 13: pendiente negativo (la mesa perdió, o el rakeback/deal no alcanzó) -> la
  // memoria CRECE por el total del déficit, nunca hay split.
  if (input.pendiente <= 0) {
    return {
      recuperacionMaxima: 0,
      memoriaAplicada: 0,
      memoriaFinal: redondear(input.memoriaActual - input.pendiente), // -pendiente es positivo
      resultadoParaSplit: 0,
      splitJugador: 0,
      splitTeamback: 0,
    };
  }

  // Sección 14 (AUTOMATICO) / 15 (PARCIAL_MANUAL)
  const recuperacionMaxima = Math.min(input.pendiente, input.memoriaActual);
  let memoriaAplicada: number;
  if (input.modoMemoria === "AUTOMATICO") {
    memoriaAplicada = recuperacionMaxima;
  } else {
    const manual = input.memoriaAplicadaManual;
    if (manual === undefined || manual === null) {
      throw new Error("Con modo de memoria PARCIAL_MANUAL hay que indicar cuánto se aplica a memoria.");
    }
    if (manual < 0) throw new Error("La memoria aplicada no puede ser negativa.");
    if (manual > recuperacionMaxima) {
      throw new Error(
        `La memoria aplicada (${manual}) no puede superar lo disponible (${recuperacionMaxima}: el menor entre el resultado pendiente y la memoria actual).`
      );
    }
    memoriaAplicada = manual;
  }

  const memoriaFinal = redondear(input.memoriaActual - memoriaAplicada);
  const resultadoParaSplit = redondear(input.pendiente - memoriaAplicada);
  const { splitJugador, splitTeamback } = calcularSplit(input.splitCfg, resultadoParaSplit);

  return {
    recuperacionMaxima: redondear(recuperacionMaxima),
    memoriaAplicada: redondear(memoriaAplicada),
    memoriaFinal,
    resultadoParaSplit,
    splitJugador,
    splitTeamback,
  };
}

// ---------- Sección 17/18: split extraordinario -- operación MANUAL autorizada. A diferencia
// del cierre mensual, "gananciaDisponible" la decide TeamBack (no se deriva sola de los
// parciales): el repo le sugiere como default el "pendiente" calculado hasta ese momento, pero
// quien autoriza puede ajustarlo -- por eso es una acción que "debe requerir autorización
// explícita" (sección 17), no un número que el sistema fuerza. ----------
export interface SplitExtraordinarioInput {
  memoriaActual: number;
  gananciaDisponible: number; // autorizado por TeamBack
  memoriaAplicada: number; // autorizado por TeamBack
  splitCfg: BancadoV1SplitConfig;
}

export interface SplitExtraordinarioResult {
  memoriaAplicada: number;
  memoriaFinal: number;
  resultadoLiberado: number;
  splitJugador: number;
  splitTeamback: number;
}

export function calcularSplitExtraordinario(input: SplitExtraordinarioInput): SplitExtraordinarioResult {
  if (input.memoriaActual < 0) throw new Error("La memoria nunca puede ser negativa.");
  if (input.gananciaDisponible < 0) throw new Error("La ganancia disponible no puede ser negativa.");
  if (input.memoriaAplicada < 0) throw new Error("La memoria aplicada no puede ser negativa.");
  if (input.memoriaAplicada > input.memoriaActual) {
    throw new Error(`La memoria aplicada (${input.memoriaAplicada}) no puede superar la memoria actual (${input.memoriaActual}).`);
  }
  if (input.memoriaAplicada > input.gananciaDisponible) {
    throw new Error(`La memoria aplicada (${input.memoriaAplicada}) no puede superar la ganancia disponible (${input.gananciaDisponible}).`);
  }

  const memoriaFinal = redondear(input.memoriaActual - input.memoriaAplicada);
  const resultadoLiberado = redondear(input.gananciaDisponible - input.memoriaAplicada);
  const { splitJugador, splitTeamback } = calcularSplit(input.splitCfg, resultadoLiberado);

  return {
    memoriaAplicada: redondear(input.memoriaAplicada),
    memoriaFinal,
    resultadoLiberado,
    splitJugador,
    splitTeamback,
  };
}

// ---------- Sección 20: ganancia TeamBack de un evento (rake directo ya se suma aparte, no
// acá -- ver repo, se contabiliza una sola vez por mes desde los parciales) ----------
export function calcularGananciaTeamback(rakeTeambackDirecto: number, splitTeamback: number): number {
  return redondear(rakeTeambackDirecto + splitTeamback);
}

// ---------- Sección 19: pago teórico vs real -> crédito pendiente del jugador ----------
export function calcularCreditoPendiente(pagoTeorico: number, pagoReal: number): number {
  return redondear(pagoTeorico - pagoReal);
}
