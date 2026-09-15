// Motor de liquidación de "jugadores bancados" — réplica exacta de la lógica ya probada en la
// planilla Google Sheets (motor "DIGIPLAYERS · MOTOR DE JUGADORES BANCADOS", primera
// implementación: Matias Fontal, TeamBack Suprema, ver comentario en schema.sql). Función pura,
// sin acceso a base — repo/bancados.ts la usa tanto para previsualizar (no escribe nada) como
// para cerrar de verdad (misma cuenta, cero margen para que la previa muestre un número
// distinto del que después se aplica).
//
// Reglas (idénticas al script original):
//  - Resultado de mesas positivo: se reparte según % jugador / % banca.
//  - Resultado de mesas negativo: la pérdida completa aumenta el makeup.
//  - El makeup NO se recupera con ganancias de mesas, solo con rakeback.
//  - El rakeback primero cancela el makeup pendiente; el excedente (una vez makeup=0) es 100%
//    del jugador.
export interface BancadoConfig {
  pctJugador: number; // 0..1
  pctBanca: number; // 0..1
  rakebackPct: number; // 0..1
  capitalInicial: number;
  makeupInicial: number;
}

export interface BancadoEstado {
  capitalActual: number;
  makeupActual: number;
}

export interface BancadoOrigen {
  resultadoMesas: number;
  rakeTotal: number;
}

export interface BancadoCierreCalculado {
  resultadoMesas: number;
  rakeTotal: number;
  rakebackTotal: number;
  makeupAnterior: number;
  perdidaAgregaMakeup: number;
  rakebackAMakeup: number;
  rakebackExcedenteJugador: number;
  makeupNuevo: number;
  pagoJugadorMesas: number;
  pagoJugadorTotal: number;
  gananciaBancaMesas: number;
  capitalAnterior: number;
  capitalDespues: number;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularCierreBancado(
  cfg: BancadoConfig,
  estado: BancadoEstado,
  origen: BancadoOrigen
): BancadoCierreCalculado {
  const resultado = origen.resultadoMesas;
  const rakebackTotal = Math.max(0, origen.rakeTotal * cfg.rakebackPct);

  const makeupAnterior = Math.max(0, estado.makeupActual ?? cfg.makeupInicial ?? 0);
  const perdidaAgregaMakeup = resultado < 0 ? Math.abs(resultado) : 0;
  const makeupAntesRB = makeupAnterior + perdidaAgregaMakeup;

  const rakebackAMakeup = Math.min(rakebackTotal, makeupAntesRB);
  const rakebackExcedenteJugador = Math.max(0, rakebackTotal - rakebackAMakeup);
  const makeupNuevo = Math.max(0, makeupAntesRB - rakebackAMakeup);

  // Las ganancias de mesas NUNCA cancelan makeup.
  const gananciaMesasPositiva = Math.max(0, resultado);
  const pagoJugadorMesas = gananciaMesasPositiva * cfg.pctJugador;
  const pagoJugadorTotal = pagoJugadorMesas + rakebackExcedenteJugador;

  // En una pérdida, la banca absorbe el 100% (no se reparte por %banca).
  const gananciaBancaMesas = resultado >= 0 ? resultado * cfg.pctBanca : resultado;

  const capitalAnterior = estado.capitalActual ?? cfg.capitalInicial ?? 0;
  const capitalDespues = capitalAnterior + resultado + rakebackTotal - pagoJugadorTotal;

  return {
    resultadoMesas: redondear(resultado),
    rakeTotal: redondear(origen.rakeTotal),
    rakebackTotal: redondear(rakebackTotal),
    makeupAnterior: redondear(makeupAnterior),
    perdidaAgregaMakeup: redondear(perdidaAgregaMakeup),
    rakebackAMakeup: redondear(rakebackAMakeup),
    rakebackExcedenteJugador: redondear(rakebackExcedenteJugador),
    makeupNuevo: redondear(makeupNuevo),
    pagoJugadorMesas: redondear(pagoJugadorMesas),
    pagoJugadorTotal: redondear(pagoJugadorTotal),
    gananciaBancaMesas: redondear(gananciaBancaMesas),
    capitalAnterior: redondear(capitalAnterior),
    capitalDespues: redondear(capitalDespues),
  };
}
