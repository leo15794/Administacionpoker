// Importador de cierres — formato "Tiny GG" (plataforma GG Poker, club "Tiny GG" en el
// catálogo — mismo tipo de plataforma que TeamBack GG / Fénix GG, pero acá cada super agente
// baja SU PROPIO archivo .xlsx semanal ("Super Agent Report") en vez de compartir un archivo
// con otros super agentes en distintas hojas — por eso este importador procesa VARIOS ARCHIVOS
// por corrida (uno por super agente), no varias hojas de un mismo archivo (ver
// repo/importsTinyGG.ts, que agrupa varios archivos en la previa).
//
// Formato real (4 hojas por archivo, bilingüe chino/inglés):
//   "1.超級代理總覽" (Super Agent Report): clave-valor libre — trae el ID/Nickname del super
//   agente y, en la fila "當週交收金額 / Weekly Settlement", un TOTAL DE CONTROL agregado que
//   la planilla original usa para cruzar contra el reporte oficial de la plataforma — NO es
//   plata que se le paga a nadie (ver más abajo).
//   "2.代理數據統計" (Agents Statistics): una fila por SUB-AGENTE (el que de verdad cobra),
//   con su propio ID/Nickname en columnas A/B y sus totales de Rake/Win-Loss. La fila "總計
//   Total" trae los totales del archivo ya sumados como VALORES LITERALES — se usa solo como
//   control cruzado contra la suma de las filas de sub-agentes.
//   "3.玩家數據" (Player Data): una fila por JUGADOR real, con su propio Member ID/Nickname y
//   el Agent ID/Nickname del sub-agente al que pertenece — esta es la hoja que se importa
//   (mismo principio que Suprema/TeamBack GG: se resuelve jugador -> agente fila por fila, y el
//   agente para plata es el Agent inmediato de esta hoja, que acá SÍ es el nivel que cobra,
//   nunca el super agente). Columnas usadas: "Win/Loss with Jackpots" (resultado) y "Fee
//   without Tournament & SNG" (rake) — ambas ya tie-out exacto contra los totales por
//   sub-agente de la hoja 2 (verificado con un reporte real, super agente dangerfish96, semana
//   31/08-06/09/2026: MutiladorDoc resultado 15.242,78 = 24.470,59 + (-9.227,81), rake
//   18.054,55 = 12.241,64 + 5.812,91 — coincide al centavo).
//   "4.額外交收" (Extra Settlements): no se parsea — ver nota histórica al pie del archivo.
//
// Fórmula de cierre por agente: la GENÉRICA de siempre — (resultado + rakeTotal) × rebatePct
// para el rebate, rakeTotal × rakebackPct para el rakeback — nada especial, ver
// engine/cierre.ts. Confirmado contra RESUMEN_TINY y CONFIG_CUENTAS_POR_CLUB_V3 de la planilla
// "automatizacion clubes" (auditoría 10/09/2026): el rebate de Tiny SIEMPRE se aplica, sin
// condición, igual que TeamBack GG — no depende de ningún "disparador". La regla
// TINY_GG_REBATE_CONDICIONAL que existía antes en engine/cierre.ts confundía el TOTAL DE
// CONTROL de la hoja 1 (agregado, a nivel super agente) con la liquidación real (por
// sub-agente) — quedó sin usar, ver el comentario ahí.
import ExcelJS from "exceljs";
import type { SupremaPlayerRow } from "./importSuprema.js";

export interface TinyGGParsedFile {
  fileName: string;
  superAgentIdRaw: string | null;
  superAgentNicknameRaw: string | null;
  rows: SupremaPlayerRow[];
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
 * Busca, dentro de un encabezado de 2 niveles (fila `headerRow` = grupo, `subRow` = detalle), la
 * columna cuyo texto de detalle es exactamente `subNeedle` DENTRO del rango de columnas cuyo
 * texto de grupo contiene `groupNeedle`. Usado en la hoja "2.代理數據統計".
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

/**
 * Misma idea que buscarColumnaDeGrupo pero para columnas de IDENTIDAD (Super Agent/Agent/
 * Member ID/Nickname) de la hoja "3.玩家數據", donde el grupo puede repetirse (Super Agent,
 * Agent, Member son 3 grupos distintos con subcolumnas ID/Nickname iguales) — por eso acá se
 * matchea grupo EXACTO, no "contiene", para no confundir un grupo con otro.
 */
function buscarColumnaIdentidad(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  subRow: number,
  maxCol: number,
  groupExacto: string,
  subNeedle: string
): number | null {
  let grupoActual = "";
  for (let c = 1; c <= maxCol; c++) {
    const g = normText(ws.getCell(headerRow, c).value);
    if (g) grupoActual = g.toLowerCase();
    const s = normText(ws.getCell(subRow, c).value);
    if (grupoActual === groupExacto && s && s.toLowerCase() === subNeedle) return c;
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
  const wsJugadores = buscarHoja(wb, "玩家數據");
  if (!wsAgentes || !wsJugadores) {
    return {
      error: {
        fileName,
        reason: 'No tiene el formato Tiny GG esperado — faltan las hojas "2.代理數據統計" y/o "3.玩家數據".',
      },
    };
  }

  const superAgentIdRaw = wsResumen ? buscarValorPorEtiqueta(wsResumen, "超級代理ID") : null;
  const superAgentNicknameRaw = wsResumen ? buscarValorPorEtiqueta(wsResumen, "超級代理暱稱") : null;

  // --- Hoja 2: totales por sub-agente (control cruzado contra la hoja 3, ver más abajo) ---
  const maxColAg = wsAgentes.columnCount || 30;
  const colRakeTotalAg = buscarColumnaDeGrupo(wsAgentes, 4, 5, maxColAg, "rake", "total");
  const colWinLossTotalAg = buscarColumnaDeGrupo(wsAgentes, 4, 5, maxColAg, "win/loss", "total");
  if (!colRakeTotalAg || !colWinLossTotalAg) {
    return {
      error: {
        fileName,
        reason: "No tiene el formato Tiny GG esperado — no se encontraron las columnas Rake Total / Win-Loss Total en la hoja de agentes.",
      },
    };
  }
  const totalesPorSubAgente = new Map<string, { rake: number; resultado: number }>();
  const limiteFilasAg = Math.max(wsAgentes.rowCount, 50);
  for (let r = 6; r <= limiteFilasAg; r++) {
    const id = normText(wsAgentes.getCell(r, 1).value);
    if (!id) continue;
    if (id.toLowerCase().includes("total")) break; // fila "總計 Total"
    totalesPorSubAgente.set(id, {
      rake: toNumber(wsAgentes.getCell(r, colRakeTotalAg).value),
      resultado: toNumber(wsAgentes.getCell(r, colWinLossTotalAg).value),
    });
  }

  // --- Hoja 3: filas de jugador (lo que realmente se importa) ---
  const maxColJ = wsJugadores.columnCount || 200;
  const colAgentId = buscarColumnaIdentidad(wsJugadores, 4, 5, maxColJ, "agent", "id");
  const colAgentNick = buscarColumnaIdentidad(wsJugadores, 4, 5, maxColJ, "agent", "nickname");
  const colMemberId = buscarColumnaIdentidad(wsJugadores, 4, 5, maxColJ, "member", "id");
  const colMemberNick = buscarColumnaIdentidad(wsJugadores, 4, 5, maxColJ, "member", "nickname");
  const colResultado = (() => {
    for (let c = 1; c <= maxColJ; c++) {
      const t = normText(wsJugadores.getCell(4, c).value);
      if (t && t.toLowerCase().includes("win/loss with jackpots")) return c;
    }
    return null;
  })();
  const colRake = (() => {
    for (let c = 1; c <= maxColJ; c++) {
      const t = normText(wsJugadores.getCell(4, c).value);
      if (t && t.toLowerCase().includes("fee without tournament")) return c;
    }
    return null;
  })();

  const faltantes: string[] = [];
  if (!colAgentId) faltantes.push("Agent ID");
  if (!colMemberId) faltantes.push("Member ID");
  if (!colResultado) faltantes.push("Win/Loss with Jackpots");
  if (!colRake) faltantes.push("Fee without Tournament & SNG");
  if (faltantes.length > 0) {
    return {
      error: {
        fileName,
        reason: `No tiene el formato Tiny GG esperado — no se encontraron estas columnas en la hoja de jugadores: ${faltantes.join(", ")}.`,
      },
    };
  }

  const rows: SupremaPlayerRow[] = [];
  const sumaPorSubAgente = new Map<string, { rake: number; resultado: number }>();
  const limiteFilasJ = Math.max(wsJugadores.rowCount, 20);
  for (let r = 7; r <= limiteFilasJ; r++) {
    // La columna "No." (1) es un número secuencial (1,2,3...) en cada fila de jugador real; la
    // fila "總計 Total" del pie de la hoja repite el texto "總計 Total" en TODAS las columnas
    // (incluida la de Member ID), así que no alcanza con chequear que Member ID no esté vacío —
    // hay que cortar apenas "No." deja de ser un número.
    if (typeof wsJugadores.getCell(r, 1).value !== "number") break;
    const memberId = normText(wsJugadores.getCell(r, colMemberId!).value);
    if (!memberId) continue; // fila vacía / de borde
    const agentIdRaw = normText(wsJugadores.getCell(r, colAgentId!).value);
    const agentNameRaw = colAgentNick ? normText(wsJugadores.getCell(r, colAgentNick).value) : agentIdRaw;
    const memberNick = colMemberNick ? normText(wsJugadores.getCell(r, colMemberNick).value) ?? memberId : memberId;
    const resultado = toNumber(wsJugadores.getCell(r, colResultado!).value);
    const rake = toNumber(wsJugadores.getCell(r, colRake!).value);

    if (agentIdRaw) {
      const acc = sumaPorSubAgente.get(agentIdRaw) ?? { rake: 0, resultado: 0 };
      acc.rake += rake;
      acc.resultado += resultado;
      sumaPorSubAgente.set(agentIdRaw, acc);
    }

    rows.push({
      playerId: memberId,
      playerName: memberNick,
      agentIdRaw,
      agentNameRaw,
      resultado,
      rake,
      rodeo: 0, // no existe "Rodeo" en esta plataforma
      role: null,
      subAgentIdRaw: null,
      subAgentNameRaw: null,
    } as SupremaPlayerRow);
  }

  // Control cruzado: la suma de las filas de jugador por sub-agente tiene que coincidir con el
  // total de ESE sub-agente en la hoja 2 — si no coincide, el formato cambió y no hay que
  // confiar en estos números (mismo criterio que TeamBack GG: se rechaza el archivo entero).
  const EPS = 0.02;
  const desvios: string[] = [];
  for (const [id, totalHoja2] of totalesPorSubAgente) {
    const sumaHoja3 = sumaPorSubAgente.get(id) ?? { rake: 0, resultado: 0 };
    if (Math.abs(sumaHoja3.rake - totalHoja2.rake) > EPS || Math.abs(sumaHoja3.resultado - totalHoja2.resultado) > EPS) {
      desvios.push(`${id} (rake: ${sumaHoja3.rake} vs ${totalHoja2.rake}; resultado: ${sumaHoja3.resultado} vs ${totalHoja2.resultado})`);
    }
  }
  // También al revés: un sub-agente que aparece en la hoja 3 pero no en la hoja 2 es señal de
  // que se coló una fila que no es de jugador real (ej. una fila de pie/total mal cortada).
  for (const id of sumaPorSubAgente.keys()) {
    if (!totalesPorSubAgente.has(id)) desvios.push(`${id} aparece en la hoja de jugadores pero no en la hoja de agentes`);
  }
  if (desvios.length > 0) {
    return {
      error: {
        fileName,
        reason: `La suma de jugadores por sub-agente no coincide con los totales de la hoja "2.代理數據統計" — puede que el formato del reporte haya cambiado. Revisar a mano antes de importar. Desvíos: ${desvios.join("; ")}.`,
      },
    };
  }

  return {
    parsed: { fileName, superAgentIdRaw, superAgentNicknameRaw, rows },
  };
}
