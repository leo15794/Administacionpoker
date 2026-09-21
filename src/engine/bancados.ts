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
  // Rakeback Banca (18/09/2026): % independiente del rakebackPct de arriba — no tienen que sumar
  // 1 entre sí. Es la parte del rake total que vuelve como rakeback pero le queda a la banca (no
  // al jugador), y se suma como ganancia real de la banca.
  rakebackBancaPct: number; // 0..1
  // % que "la Unión" le reconoce a la banca sobre el rake total (ej. 0.80) — puramente
  // informativo, no mueve plata en el sistema.
  unionSharePct: number; // 0..1
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
  // Ticket promocional (21/09/2026): un regalo que le hacemos a un jugador bancado, pagado por
  // DigiPlayers -- NO por el bancado. Se resta solo de gananciaBancaMesas (nuestra parte); no
  // toca pagoJugadorTotal, makeup ni capital -- al bancado le queda todo exactamente igual que
  // si el ticket no hubiera existido.
  ticketPromocional?: number;
}

export interface BancadoCierreCalculado {
  resultadoMesas: number;
  rakeTotal: number;
  ticketPromocional: number;
  rakebackTotal: number;
  makeupAnterior: number;
  perdidaAgregaMakeup: number;
  rakebackAMakeup: number;
  rakebackExcedenteJugador: number;
  makeupNuevo: number;
  pagoJugadorMesas: number;
  pagoJugadorTotal: number;
  gananciaBancaMesas: number;
  // Rakeback Banca de esta semana (real, ya incluido dentro de gananciaBancaMesas — ver más
  // abajo) y el % informativo de la Unión sobre el rake total (no se suma a ninguna ganancia).
  rakebackBancaTotal: number;
  unionShareTotal: number;
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
  const gananciaBancaMesasPuras = resultado >= 0 ? resultado * cfg.pctBanca : resultado;

  // Rakeback Banca: % independiente sobre el rake total (no depende de si hubo pérdida o
  // ganancia en mesas, ni del makeup) — se suma directo como ganancia real de la banca.
  const rakebackBancaTotal = Math.max(0, origen.rakeTotal * cfg.rakebackBancaPct);
  const ticketPromocional = origen.ticketPromocional ?? 0;
  // El ticket sale de nuestro bolsillo, no del bancado -- se resta ACA, sobre lo que nos queda
  // a nosotros, despues de calcular su parte real (que no se toca).
  const gananciaBancaMesas = gananciaBancaMesasPuras + rakebackBancaTotal - ticketPromocional;

  // Puramente informativo — nunca mueve plata, solo para ver cuánto le corresponde reclamar a
  // la Unión sobre el rake total de esta semana.
  const unionShareTotal = origen.rakeTotal * cfg.unionSharePct;

  // El "capital" es el saldo acumulado del JUGADOR (no la caja de la banca): crece con el
  // resultado de mesas de esta semana, punto — no se le resta lo que se le paga esta semana
  // (pagoJugadorTotal es cuánto le corresponde cobrar, un dato aparte, no una salida de este
  // saldo) ni el rakeback (que tampoco toca este número, ver arriba).
  const capitalAnterior = estado.capitalActual ?? cfg.capitalInicial ?? 0;
  const capitalDespues = capitalAnterior + resultado;

  return {
    resultadoMesas: redondear(resultado),
    rakeTotal: redondear(origen.rakeTotal),
    ticketPromocional: redondear(ticketPromocional),
    rakebackTotal: redondear(rakebackTotal),
    makeupAnterior: redondear(makeupAnterior),
    perdidaAgregaMakeup: redondear(perdidaAgregaMakeup),
    rakebackAMakeup: redondear(rakebackAMakeup),
    rakebackExcedenteJugador: redondear(rakebackExcedenteJugador),
    makeupNuevo: redondear(makeupNuevo),
    pagoJugadorMesas: redondear(pagoJugadorMesas),
    pagoJugadorTotal: redondear(pagoJugadorTotal),
    gananciaBancaMesas: redondear(gananciaBancaMesas),
    rakebackBancaTotal: redondear(rakebackBancaTotal),
    unionShareTotal: redondear(unionShareTotal),
    capitalAnterior: redondear(capitalAnterior),
    capitalDespues: redondear(capitalDespues),
  };
}
