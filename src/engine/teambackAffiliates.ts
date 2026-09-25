// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- motor de cálculo puro, sin acceso a
// base, mismo patrón que engine/bancados.ts: repo/teamback.ts la usa tanto para previsualizar
// como para calcular/guardar de verdad la liquidación semanal real, misma cuenta siempre.
//
// Sección TOTALMENTE APARTE del resto del sistema -- este es un programa de rakeback +
// referidos directo al JUGADOR sobre Suprema Poker, nada que ver con el negocio de "backing" de
// agentes (agents/clubs/balances) que es el resto de la app.

export interface TbConfig {
  pctBase: number; // 0.60
  pctTier2: number; // 0.63
  pctTier3: number; // 0.65
  umbralVolumenTier2Usd: number; // 500
  umbralVolumenTier3Usd: number; // 1000
  umbralReferidosTier2: number; // 3
  umbralReferidosTier3: number; // 5
  umbralReferidoActivoUsd: number; // 20
  pctComisionReferido: number; // 0.03
  aplicarUmbralAComision: boolean; // default false
  ventanaActividadSemanas: number; // 4
}

export type TierAlcanzadoPor = "VOLUMEN" | "REFERIDOS" | "BASE";

export interface EscalonResultado {
  pct: number;
  alcanzadoPor: TierAlcanzadoPor;
}

/** Un referido cuenta como "activo" esa semana si generó >= umbralReferidoActivoUsd de rake
 * bruto. Se usa tanto para contar referidos activos (escalón por referidos) como, opcionalmente
 * (aplicarUmbralAComision), para decidir si ESE referido puntual genera comisión esa semana. */
export function esReferidoActivo(rakeBrutoDelReferido: number, cfg: TbConfig): boolean {
  return rakeBrutoDelReferido >= cfg.umbralReferidoActivoUsd;
}

/** Escalón de rakeback de la semana: el mejor de los dos caminos (volumen propio vs referidos
 * activos), NO acumulables -- se recalcula de cero cada semana, no hay "escalón permanente". */
export function calcularEscalonRakeback(
  rakePropio: number,
  referidosActivosCount: number,
  cfg: TbConfig
): EscalonResultado {
  const porVolumen = rakePropio >= cfg.umbralVolumenTier3Usd ? cfg.pctTier3 : rakePropio >= cfg.umbralVolumenTier2Usd ? cfg.pctTier2 : cfg.pctBase;
  const porReferidos =
    referidosActivosCount >= cfg.umbralReferidosTier3
      ? cfg.pctTier3
      : referidosActivosCount >= cfg.umbralReferidosTier2
        ? cfg.pctTier2
        : cfg.pctBase;

  const mejor = Math.max(porVolumen, porReferidos);
  const alcanzadoPor: TierAlcanzadoPor = mejor === cfg.pctBase ? "BASE" : mejor === porVolumen && mejor !== porReferidos ? "VOLUMEN" : mejor === porReferidos && mejor !== porVolumen ? "REFERIDOS" : "VOLUMEN"; // empate: da igual, se muestra "VOLUMEN" por elegir algo

  return { pct: mejor, alcanzadoPor };
}

/** (25/09/2026, pedido de Leo: "cambiar la regla de la inactividad de los referidos" -- sacar
 * el requisito por completo, ejemplo real: mininok tenía 2 referidos activos generando rake pero
 * su comisión quedaba en $0 "pausada" porque ÉL no había jugado. Ahora la comisión de afiliado
 * se cobra siempre que el referido genere rake, sin importar si el referente jugó o no esa
 * semana ni en semanas anteriores. Esta función queda pero siempre devuelve true -- se deja el
 * parámetro rakePropioUltimasSemanas por compatibilidad (repo/teamback.ts todavía lo calcula y
 * se lo pasa) por si en el futuro se quiere volver a exigir algún tipo de actividad. */
export function estaActivoEnVentana(_rakePropioSemanaActual: number, _rakePropioUltimasSemanas: number[]): boolean {
  return true;
}

export interface OrigenLiquidacionSemanal {
  rakePropio: number;
  // Rake bruto de cada referido DIRECTO esta semana (uno por referido) -- V1 solo paga el nivel
  // directo, pero se recibe la lista completa (no un total pre-sumado) para poder aplicar el
  // umbral por referido si aplicarUmbralAComision está prendido.
  rakeReferidosDirectos: number[];
  // Rake propio del referente en cada una de las últimas `ventanaActividadSemanas` semanas
  // ANTERIORES a esta (no incluye la semana que se está liquidando).
  rakePropioSemanasAnteriores: number[];
}

export interface LiquidacionSemanalCalculada {
  rakePropio: number;
  referidosActivosCount: number;
  tierAlcanzadoPor: TierAlcanzadoPor;
  rakebackPct: number;
  rakebackGenerado: number;
  rakeReferidosDirectos: number;
  comision3pctBruta: number;
  comision3pctPausada: boolean;
  comision3pctAcreditada: number;
  totalAcreditado: number;
  activoEnVentana: boolean;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularLiquidacionSemanal(origen: OrigenLiquidacionSemanal, cfg: TbConfig): LiquidacionSemanalCalculada {
  const referidosActivosCount = origen.rakeReferidosDirectos.filter((r) => esReferidoActivo(r, cfg)).length;
  const { pct: rakebackPct, alcanzadoPor: tierAlcanzadoPor } = calcularEscalonRakeback(origen.rakePropio, referidosActivosCount, cfg);
  const rakebackGenerado = origen.rakePropio * rakebackPct;

  const rakeReferidosDirectos = origen.rakeReferidosDirectos.reduce((a, b) => a + b, 0);
  // Comisión bruta: por defecto, 3% de CADA referido directo sin piso. Si aplicarUmbralAComision
  // está prendido, un referido que no llegó al umbral esa semana no aporta a la comisión.
  const rakeQueGeneraComision = cfg.aplicarUmbralAComision
    ? origen.rakeReferidosDirectos.filter((r) => esReferidoActivo(r, cfg)).reduce((a, b) => a + b, 0)
    : rakeReferidosDirectos;
  const comision3pctBruta = rakeQueGeneraComision * cfg.pctComisionReferido;

  const activoEnVentana = estaActivoEnVentana(origen.rakePropio, origen.rakePropioSemanasAnteriores);
  const comision3pctPausada = !activoEnVentana;
  const comision3pctAcreditada = comision3pctPausada ? 0 : comision3pctBruta;

  const totalAcreditado = rakebackGenerado + comision3pctAcreditada;

  return {
    rakePropio: redondear(origen.rakePropio),
    referidosActivosCount,
    tierAlcanzadoPor,
    rakebackPct,
    rakebackGenerado: redondear(rakebackGenerado),
    rakeReferidosDirectos: redondear(rakeReferidosDirectos),
    comision3pctBruta: redondear(comision3pctBruta),
    comision3pctPausada,
    comision3pctAcreditada: redondear(comision3pctAcreditada),
    totalAcreditado: redondear(totalAcreditado),
    activoEnVentana,
  };
}
