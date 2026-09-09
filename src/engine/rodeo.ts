// "Rodeo" — solo SupremaPoker (Fénix, TeamBack), pedido explícito del usuario. Reglas
// verbatim que dio el usuario:
//   - Si el jugador PIERDE esa semana, genera rodeo positivo (a favor de la casa).
//   - Si el jugador GANA, genera "memoria" negativa: esa pérdida se acumula y se compensa
//     con futuras semanas en las que vuelva a perder. Nunca se arranca de cero mientras haya
//     memoria pendiente (misma lógica que la deuda eterna de bancados).
//   - Reparto del rodeo ya neto de memoria ("payable"):
//       Sin agente:  30% App + 35% Unión + 35% Club
//       Con agente:  30% App + 35% Unión + 20% Club + 15% Agente
//   - CORRECCIÓN (auditoría contra la planilla real, hoja MEMORIA_RODEO): la memoria NO es por
//     jugador — es por AGENTE+CLUB. La planilla agrega el rodeo bruto de TODOS los jugadores de
//     un agente antes de netear contra la memoria arrastrada; un jugador que gana no genera
//     memoria aislada de sí mismo, esa pérdida se compensa contra lo que generen los OTROS
//     jugadores del mismo agente esa misma semana. Antes (por jugador) esto pagaba de más al
//     agente cuando tenía jugadores mixtos (unos ganando, otros perdiendo) en la misma semana.
// App y Unión son terceros fuera de nuestro sistema: no se registran en ningún lado. El
// share de Club es informativo (como la ganancia de DigiPlayers en bancados: "fichas que
// quedan", nunca se acredita a ningún agente). El share de Agente SÍ es plata real y se
// suma directo al cierre final de ese agente (decisión explícita del usuario).
export interface RodeoJugadorEntrada {
  playerExternalId: string;
  baseRodeo: number; // signo: positivo = jugador perdió (a favor), negativo = jugador ganó (en contra)
}

export interface RodeoAgenteInput {
  jugadores: RodeoJugadorEntrada[];
  memoriaAnterior: number; // deuda pendiente del AGENTE (no del jugador) en este club, siempre >= 0
  tieneAgente: boolean; // en la práctica siempre true (ver repo/rodeo.ts) — se mantiene por si a futuro hay rodeo sin agente
}

export interface RodeoAgenteResult {
  baseRodeoTotal: number; // suma del rodeo bruto de todos los jugadores del agente esta semana
  jugadores: RodeoJugadorEntrada[]; // desglose informativo — cuánto aportó cada jugador antes de sumar
  memoriaAnterior: number;
  payable: number; // lo que queda para repartir esta semana, ya neto de memoria (0 si no alcanzó)
  memoriaNueva: number;
  clubShare: number; // informativo, nunca se acredita a nadie
  agentShare: number; // se acredita 100% al agente sumado directo al cierre final
}

export function calcularRodeoAgente(input: RodeoAgenteInput): RodeoAgenteResult {
  const baseRodeoTotal = input.jugadores.reduce((sum, j) => sum + j.baseRodeo, 0);
  const net = baseRodeoTotal - input.memoriaAnterior;
  const payable = net > 0 ? net : 0;
  const memoriaNueva = net > 0 ? 0 : -net;
  const clubSharePct = input.tieneAgente ? 0.2 : 0.35;
  const agentSharePct = input.tieneAgente ? 0.15 : 0;
  return {
    baseRodeoTotal,
    jugadores: input.jugadores,
    memoriaAnterior: input.memoriaAnterior,
    payable,
    memoriaNueva,
    clubShare: payable * clubSharePct,
    agentShare: payable * agentSharePct,
  };
}
