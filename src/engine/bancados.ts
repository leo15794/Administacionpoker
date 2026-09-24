// Motor de liquidación de "jugadores bancados" — réplica exacta de la lógica ya probada en la
// planilla Google Sheets (motor "DIGIPLAYERS · MOTOR DE JUGADORES BANCADOS", primera
// implementación: Matias Fontal, TeamBack Suprema, ver comentario en schema.sql). Función pura,
// sin acceso a base — repo/bancados.ts la usa tanto para previsualizar (no escribe nada) como
// para cerrar de verdad (misma cuenta, cero margen para que la previa muestre un número
// distinto del que después se aplica).
//
// Reglas:
//  - Resultado de mesas negativo: la pérdida completa aumenta el makeup.
//  - Resultado de mesas positivo (24/09/2026, cambio pedido por Leo -- antes las ganancias de
//    mesas NUNCA tocaban el makeup, ahora sí): la parte de la banca (% banca) es siempre suya,
//    intacta, nunca va al makeup. La parte del jugador (% jugador) SÍ se usa primero para
//    cancelar el makeup pendiente -- Leo, con ejemplos numéricos: "las ganancias de mesas
//    cancelan solo el 50% de la ganancia, el otro 50% es de la banca" (con % jugador/% banca
//    en 50/50, que es el default) / si el makeup ya se cubre con menos de esa parte, "en este
//    caso queda todo para el jugador porque la banca ya se llevó el 50% de la ganancia de la
//    mesa" -- el sobrante de la parte del jugador, una vez saldado el makeup, es 100% suyo.
//  - El rakeback también cancela el makeup pendiente primero (sin cambios); el excedente (una
//    vez makeup=0) es 100% del jugador. Orden de aplicación cuando hay ambos en la misma
//    semana (rakeback Y ganancia de mesas con makeup pendiente): primero se aplica el
//    rakeback, después la parte del jugador de la ganancia de mesas -- no cambia el total que
//    termina cobrando el jugador (ambos excedentes son igual de suyos), solo cómo se desglosa
//    en la memoria de dónde salió cada parte.
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
  // Ticket promocional (21/09/2026, ajustado 23/09/2026): un regalo que le hacemos a un
  // jugador bancado, pagado por DigiPlayers -- NO por el bancado. Se resta de gananciaBancaMesas
  // (nuestra parte) Y reduce la pérdida neta que alimenta el makeup (ver calcularCierreBancado):
  // al jugador se le "perdona" esa parte de su pérdida para el cálculo de la memoria. No toca
  // resultadoMesas, pagoJugadorTotal ni capital -- esos siguen siendo el resultado real de mesas.
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
  // Desglose de la parte del jugador en la ganancia de mesas (24/09/2026): gananciaMesasJugadorBruta
  // es lo que le tocaría al jugador por % jugador ANTES de descontar makeup; gananciaMesasAMakeup
  // es cuánto de eso se usó para cancelar makeup pendiente (después de aplicar el rakeback, ver
  // reglas arriba). pagoJugadorMesas queda como el NETO ya cobrable (gananciaMesasJugadorBruta -
  // gananciaMesasAMakeup) -- mismo nombre de siempre, mismo significado de cara al pago final.
  gananciaMesasJugadorBruta: number;
  gananciaMesasAMakeup: number;
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
  const ticketPromocional = origen.ticketPromocional ?? 0;

  // El ticket promocional es un regalo que DigiPlayers le hace al jugador (no el bancado) para
  // cubrir parte de su pérdida en mesas -- por eso, a los fines del makeup ("la memoria" del
  // bancado), la pérdida que se le carga es la pérdida NETA de ese regalo, no la pérdida bruta
  // de mesas (23/09/2026, pedido explícito de Leo con ejemplo numérico: resultado -189.22 +
  // ticket 48 = pérdida neta 141.22 -> makeup nuevo 138.07 en vez de 186.07). El resultado de
  // mesas "crudo" (resultadoMesas / capitalDespues / pagoJugadorMesas) NO se toca -- sigue
  // siendo el resultado real de las manos jugadas.
  const resultadoNetoTicket = resultado + ticketPromocional;
  const makeupAnterior = Math.max(0, estado.makeupActual ?? cfg.makeupInicial ?? 0);
  const perdidaAgregaMakeup = resultadoNetoTicket < 0 ? Math.abs(resultadoNetoTicket) : 0;
  const makeupAntesRB = makeupAnterior + perdidaAgregaMakeup;

  const rakebackAMakeup = Math.min(rakebackTotal, makeupAntesRB);
  const rakebackExcedenteJugador = Math.max(0, rakebackTotal - rakebackAMakeup);
  const makeupDespuesRakeback = Math.max(0, makeupAntesRB - rakebackAMakeup);

  // Ganancias de mesas (24/09/2026): la parte del jugador (% jugador) cancela primero lo que
  // haya quedado de makeup después del rakeback -- la parte de la banca (% banca, ver
  // gananciaBancaMesasPuras más abajo) nunca se toca, es siempre suya.
  const gananciaMesasPositiva = Math.max(0, resultado);
  const gananciaMesasJugadorBruta = gananciaMesasPositiva * cfg.pctJugador;
  const gananciaMesasAMakeup = Math.min(gananciaMesasJugadorBruta, makeupDespuesRakeback);
  const makeupNuevo = Math.max(0, makeupDespuesRakeback - gananciaMesasAMakeup);
  const pagoJugadorMesas = gananciaMesasJugadorBruta - gananciaMesasAMakeup;
  const pagoJugadorTotal = pagoJugadorMesas + rakebackExcedenteJugador;

  // En una pérdida, la banca absorbe el 100% (no se reparte por %banca).
  const gananciaBancaMesasPuras = resultado >= 0 ? resultado * cfg.pctBanca : resultado;

  // Rakeback Banca: % independiente sobre el rake total (no depende de si hubo pérdida o
  // ganancia en mesas, ni del makeup) — se suma directo como ganancia real de la banca.
  const rakebackBancaTotal = Math.max(0, origen.rakeTotal * cfg.rakebackBancaPct);
  // El ticket sale de nuestro bolsillo, no del bancado -- se resta ACA, sobre lo que nos queda
  // a nosotros, despues de calcular su parte real (que no se toca). (ticketPromocional ya se
  // extrajo arriba, antes del cálculo de makeup -- ver comentario ahí.)
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
    gananciaMesasJugadorBruta: redondear(gananciaMesasJugadorBruta),
    gananciaMesasAMakeup: redondear(gananciaMesasAMakeup),
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
