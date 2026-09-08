// "Rodeo" — solo SupremaPoker (Fénix, TeamBack), pedido explícito del usuario. Reglas
// verbatim que dio el usuario:
//   - Si el jugador PIERDE esa semana, genera rodeo positivo (a favor de la casa).
//   - Si el jugador GANA, genera "memoria" negativa: esa pérdida se acumula y se compensa
//     con futuras semanas en las que el MISMO jugador vuelva a perder. Nunca se arranca de
//     cero mientras haya memoria pendiente (misma lógica que la deuda eterna de bancados).
//   - Reparto del rodeo ya neto de memoria ("payable"):
//       Sin agente:  30% App + 35% Unión + 35% Club
//       Con agente:  30% App + 35% Unión + 20% Club + 15% Agente
//   - La memoria es POR JUGADOR (Player ID), independiente de fichas/cargas/descargas/saldo
//     operativo del agente — nunca se mezcla con esa cuenta corriente.
// App y Unión son terceros fuera de nuestro sistema: no se registran en ningún lado. El
// share de Club es informativo (como la ganancia de DigiPlayers en bancados: "fichas que
// quedan", nunca se acredita a ningún agente). El share de Agente SÍ es plata real y se
// suma directo al cierre final de ese agente (decisión explícita del usuario).
export interface RodeoJugadorInput {
  playerExternalId: string;
  baseRodeo: number; // signo: positivo = jugador perdió (a favor), negativo = jugador ganó (en contra)
  memoriaAnterior: number; // deuda pendiente arrastrada, siempre >= 0
  tieneAgente: boolean;
}

export interface RodeoJugadorResult {
  playerExternalId: string;
  baseRodeo: number;
  memoriaAnterior: number;
  payable: number; // lo que queda para repartir esta semana, ya neto de memoria (0 si no alcanzó)
  memoriaNueva: number;
  clubShare: number; // informativo, nunca se acredita a nadie
  agentShare: number; // se acredita 100% al agente (si tiene) sumado directo al cierre final
}

export function calcularRodeoJugador(input: RodeoJugadorInput): RodeoJugadorResult {
  const net = input.baseRodeo - input.memoriaAnterior;
  const payable = net > 0 ? net : 0;
  const memoriaNueva = net > 0 ? 0 : -net;
  const clubSharePct = input.tieneAgente ? 0.2 : 0.35;
  const agentSharePct = input.tieneAgente ? 0.15 : 0;
  return {
    playerExternalId: input.playerExternalId,
    baseRodeo: input.baseRodeo,
    memoriaAnterior: input.memoriaAnterior,
    payable,
    memoriaNueva,
    clubShare: payable * clubSharePct,
    agentShare: payable * agentSharePct,
  };
}
