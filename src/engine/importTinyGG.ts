// Importador de cierres — formato "Tiny GG" (plataforma GG Poker, club "Tiny" en el catálogo —
// mismo tipo de plataforma que TeamBack GG / Fénix GG, pero acá cada super agente baja SU
// PROPIO archivo .xlsx semanal ("Super Agent Report") en vez de compartir un archivo con otros
// super agentes en distintas hojas — por eso este importador procesa VARIOS ARCHIVOS por
// corrida (uno por super agente), no varias hojas de un mismo archivo (ver
// repo/importsTinyGG.ts, que sí agrupa varios archivos en la previa).
//
// Formato real (4 hojas por archivo, bilingüe chino/inglés):
//   "2.代理數據統計" (Agents Statistics): encabezado de 2 niveles (grupo en fila 4, detalle en
//   fila 5). Columnas A/B = ID/Nickname del super agente — se repiten IGUALES en cada fila de
//   agente debajo de él (una fila por sub-agente/jugador directo), así que alcanza con leer la
//   primera fila de datos. Grupo "服務費 Rake" (Rake) con subcolumna "Total"; grupo "輸贏
//   Win/Loss" con subcolumna "Total". La fila "總計 Total" trae los totales ya sumados como
//   VALORES LITERALES (no fórmula) — se puede leer directo y cruzar contra la suma manual.
//   "3.玩家數據" (Player Data): encabezado de 3 niveles (filas 4-6), incluye el grupo "Bad Beat
//   Jackpot" -> "Contribution Fee" por jugador. Acá la fila "總計 Total" (fila 13) SÍ es una
//   fórmula sin valor cacheado (el exportador no la recalculó) — se suma fila por fila a mano.
//
// Fórmula de cierre (dada por el usuario y verificada EXACTA contra un reporte real: super
// agente "dangerfish96", semana 31/08 al 06/09/2026 — coincide al centavo con el total que trae
// el propio reporte, ver hoja 1 "當週交收金額"):
//   baseRebate = Resultado + Rake + Fee de contribución a Bad Beat Jackpot, TODO sumado para el
//                super agente completo (nunca por sub-agente/jugador individual debajo de él).
//   El rebate solo se dispara (y siempre SUMA, nunca resta) cuando baseRebate da negativo esa
//   semana — ver engine/cierre.ts, specialRule "TINY_GG_REBATE_CONDICIONAL", que es quien hace
//   ese cálculo final; este archivo solo extrae los 3 números crudos (resultado, rake, bbj).
import ExcelJS from "exceljs";

export interface TinyGGParsedFile {
  fileName: string;
  superAgentIdRaw: string | null;
  superAgentNicknameRaw: string | null;
  resultado: number;
  rake: number;
  bbjContribution: number;
}

export interface TinyGGParseError {
  fileName: string;
  reason: string;
}

export type TinyGGParseOutcome = { parsed: TinyGGParsedFile } | { error: TinyGGParseError };

function normText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === "object" && v && "text" in (v as any) ? (v as any).text : v).trim();
  if (s === "" || s.toLowerCase() === "none" || s === "-") return null;
  return s;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in (v as any)) return Number((v as any).result) || 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buscarHoja(wb: ExcelJS.Workbook, needle: string): ExcelJS.Worksheet | null {
  return wb.worksheets.find((ws) => ws.name.includes(needle)) ?? null;
}

/**
 * Hoja "1.超級代理總覽" (Super Agent Report): formato clave-valor libre, no tabular — busca una
 * fila cuya primera celda contenga `etiquetaNeedle` y devuelve el texto de la celda siguiente en
 * esa misma fila (ej. "超級代理ID (Super Agent ID)" en A6 -> el ID real está en B6).
 */
function buscarValorPorEtiqueta(ws: ExcelJS.Worksheet, etiquetaNeedle: string): string | null {
  const limiteFilas = Math.max(ws.rowCount, 30);
  for (let r = 1; r <= limiteFilas; r++) {
    const etiqueta = normText(ws.getCell(r, 1).value);
    if (etiqueta && etiqueta.includes(etiquetaNeedle)) {
      return normText(ws.getCell(r, 2).value);
    }
  }
  return null;
}

/**
 * Busca, dentro de un encabezado de grupo (fila `headerRow`) + detalle (fila `subRow`), la
 * columna cuyo texto de detalle es exactamente `subNeedle` DENTRO del rango de columnas cuyo
 * texto de grupo contiene `groupNeedle` — mismo principio que buscarColumnaTotalDeGrupo de
 * engine/importTeamBackGG.ts, con un encabezado de 2 niveles en vez de 3.
 */
function buscarColumnaDeGrupo(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  subRow: number,
  maxCol: number,
  groupNeedle: string,
  subNeedle: string
): number | null {
  let enGrupo = false;
  for (let c = 1; c <= maxCol; c++) {
    const g = normText(ws.getCell(headerRow, c).value);
    if (g) enGrupo = g.toLowerCase().includes(groupNeedle);
    if (enGrupo) {
      const s = normText(ws.getCell(subRow, c).value);
      if (s && s.toLowerCase() === subNeedle) return c;
    }
  }
  return null;
}

export async function parseTinyGGFile(buffer: Buffer, fileName: string): Promise<TinyGGParseOutcome> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    return { error: { fileName, reason: "No se pudo leer el archivo — ¿es un .xlsx válido?" } };
  }

  const wsResumen = buscarHoja(wb, "超級代理總覽");
  const wsAgentes = buscarHoja(wb, "代理數據統計");
  if (!wsAgentes) {
    return {
      error: {
        fileName,
        reason: 'No tiene el formato Tiny GG esperado — no se encontró la hoja "2.代理數據統計" (Agents Statistics).',
      },
    };
  }

  const maxCol = wsAgentes.columnCount || 30;
  const colRakeTotal = buscarColumnaDeGrupo(wsAgentes, 4, 5, maxCol, "rake", "total");
  const colWinLossTotal = buscarColumnaDeGrupo(wsAgentes, 4, 5, maxCol, "win/loss", "total");
  if (!colRakeTotal || !colWinLossTotal) {
    return {
      error: {
        fileName,
        reason: "No tiene el formato Tiny GG esperado — no se encontraron las columnas Rake Total / Win-Loss Total en la hoja de agentes.",
      },
    };
  }

  const limiteFilas = Math.max(wsAgentes.rowCount, 50);
  let filaTotal: number | null = null;
  for (let r = 6; r <= limiteFilas; r++) {
    const t = normText(wsAgentes.getCell(r, 1).value);
    if (t && t.toLowerCase().includes("total")) {
      filaTotal = r;
      break;
    }
  }
  if (!filaTotal) {
    return { error: { fileName, reason: 'No se encontró la fila "總計 Total" en la hoja de agentes.' } };
  }

  // El super agente (el AGENTE para plata, mismo principio que GG: "el nivel más alto de la
  // cadena") está en la hoja "1.超級代理總覽", NO en las columnas A/B de "2.代理數據統計" —
  // esas son el Agent ID/Nickname de cada SUB-agente individual debajo del super agente, un
  // nivel más abajo en la jerarquía (ver comentario del archivo más arriba).
  const superAgentIdRaw = wsResumen ? buscarValorPorEtiqueta(wsResumen, "超級代理ID") : null;
  const superAgentNicknameRaw = wsResumen ? buscarValorPorEtiqueta(wsResumen, "超級代理暱稱") : null;
  const resultado = toNumber(wsAgentes.getCell(filaTotal, colWinLossTotal).value);
  const rake = toNumber(wsAgentes.getCell(filaTotal, colRakeTotal).value);

  // Control cruzado: si la suma fila por fila no coincide con la fila "Total" leída arriba, el
  // formato del reporte cambió y no hay que confiar en estos números (mismo criterio que
  // TeamBack GG: se rechaza el archivo entero en vez de importar algo que no cierra).
  let sumaRake = 0;
  let sumaResultado = 0;
  for (let r = 6; r < filaTotal; r++) {
    sumaRake += toNumber(wsAgentes.getCell(r, colRakeTotal).value);
    sumaResultado += toNumber(wsAgentes.getCell(r, colWinLossTotal).value);
  }
  const EPS = 0.02;
  if (Math.abs(sumaRake - rake) > EPS || Math.abs(sumaResultado - resultado) > EPS) {
    return {
      error: {
        fileName,
        reason: `La suma de las filas no coincide con la fila TOTAL del archivo (rake: ${sumaRake} vs ${rake}; resultado: ${sumaResultado} vs ${resultado}) — puede que el formato del reporte haya cambiado. Revisar a mano antes de importar.`,
      },
    };
  }

  // Bad Beat Jackpot -> Contribution Fee: solo existe en "3.玩家數據", con fila Total en
  // fórmula (sin valor cacheado) — se suma fila por fila directamente. Si la hoja o la columna
  // no aparecen, se asume 0 (no bloquea la importación) y queda igual reflejado en el resultado.
  let bbjContribution = 0;
  const wsJugadores = buscarHoja(wb, "玩家數據");
  if (wsJugadores) {
    const maxColJ = wsJugadores.columnCount || 200;
    const colBbj = buscarColumnaDeGrupo(wsJugadores, 4, 5, maxColJ, "bad beat jackpot", "contribution fee");
    if (colBbj) {
      const limiteFilasJ = Math.max(wsJugadores.rowCount, 20);
      for (let r = 7; r <= limiteFilasJ; r++) {
        const idCell = wsJugadores.getCell(r, 1).value;
        if (typeof idCell !== "number") break; // fin de los datos (fila "總計 Total" u otra cosa)
        bbjContribution += toNumber(wsJugadores.getCell(r, colBbj).value);
      }
    }
  }

  return {
    parsed: {
      fileName,
      superAgentIdRaw,
      superAgentNicknameRaw,
      resultado: Math.round(resultado * 100) / 100,
      rake: Math.round(rake * 100) / 100,
      bbjContribution: Math.round(bbjContribution * 100) / 100,
    },
  };
}
