// Importador de cierres — formato SupremaPoker (Fénix, TeamBack).
// Motor PURO (sin DB, sin red): dado el buffer de un .xlsx, devuelve filas de jugador ya
// parseadas y normalizadas. La resolución de agente (por override, external_id o nombre)
// y todo lo que toca la base vive en repo/imports.ts — acá solo se entiende el archivo.
//
// Fórmula verificada contra dos cierres reales (semana 233, clubes Fénix y TeamBack):
//   Resultado agente = suma de "Total(Local)" de sus jugadores (ya en USD, sin conversión).
//   Rake agente      = suma de "Ring Game Total(Local)" + "MTT Total(Local)" + "SNG Total(Local)"
//                       + "SPIN Total(Local)" + "TLT Total(Local)" de sus jugadores.
// Verificado centavo a centavo contra el resumen real de esa semana (Fénix: 1.997,61 de rake;
// TeamBack: 4.191,60 de rake). No inventar otra fórmula sin volver a verificar así.
//
// "Rodeo" (solo SupremaPoker, pedido explícito del usuario): columna "Total Profit Rodeo(Local)"
// del mismo reporte — un bono de ganancia por jugador que la plataforma ya calcula. Se acredita
// 100% al agente (nunca se multiplica por ningún % ni se desvía a un supervisor). Verificado
// contra dos filas reales del histórico (REPORTE ACTUAL DE MANZUR / DETALLE DE JUGADORES):
// Cierre = Resultado ajustado + Rakeback + Rodeo + Ventas — encaja centavo a centavo.
//
// FIX 07/10/2026 (Leo: "hicieron un cambio en el cierre de suprema... ahora no funciona"):
// la plataforma renombró esa columna a "Total Winnings Rodeo(Local)" (reporte semana 238) y
// además reordenó/agregó un montón de columnas nuevas desglosadas por tipo de juego -- el resto
// del reporte no cambió, solo ese nombre. Leo confirmó (07/10/2026) que sigue siendo el mismo
// profit neto de siempre, no hay que restarle nada (ej. la "Total Stakes(Local)" que apareció
// al lado NO es parte de este cálculo). Se acepta cualquiera de los dos nombres (RODEO_HEADER_
// ALIASES) para no romper de nuevo si vuelven a cambiarlo, y para poder re-parsear reportes
// viejos que todavía tengan el nombre original.
//
// FIX 07/10/2026 #2 (Leo: "lo nuevo es lo de los spins"): el mismo cambio de reporte rompió
// el rake de Spin -- "SPIN Total(Local)" y "SPIN Admin Fee(Local)" (las columnas que antes
// traían el rake de Spin ya calculado) ahora vienen siempre en 0. Leo confirmó la fórmula
// real para reconstruirlo (07/10/2026): rake de Spin = 8% de "Total Stakes Spin(Local)"
// (columna nueva de este mismo reporte). Verificado contra el cierre real de F coco
// (TeamBack Suprema, semana 238): stakes_spin=24.00 -> spin=24*0.08=1.92, que sumado a
// ring_game+mtt+sng+tlt dio rake_total=318.308, y con su 70% de rakeback (222.8156) el
// cierre final=737.3456 -- Leo confirmó que ese número cierra contra lo real. Si el archivo
// no tiene la columna de stakes (reporte viejo) se cae al valor nativo de "SPIN Total(Local)".
import ExcelJS from "exceljs";

const REQUIRED_HEADERS = [
  "Player ID",
  "Player Name",
  "Agent ID",
  "Agent Name",
  "Total(Local)",
  "Ring Game Total(Local)",
  "MTT Total(Local)",
  "SNG Total(Local)",
  "SPIN Total(Local)",
  "TLT Total(Local)",
] as const;

// Alias del nombre de columna de Rodeo (ver FIX 07/10/2026 arriba) -- se acepta cualquiera de
// los dos, el primero que aparezca en la hoja. Clave interna "RODEO" (no es un header real) en
// vez de agregar los dos textos reales a REQUIRED_HEADERS, porque ahí alcanza con que UNO de
// los dos esté presente, no los dos a la vez.
const RODEO_HEADER_ALIASES = ["Total Profit Rodeo(Local)", "Total Winnings Rodeo(Local)"] as const;
const RODEO_KEY = "RODEO";

// Spin (ver FIX 07/10/2026 #2 arriba): columna nueva de este mismo reporte, usada para
// reconstruir el rake de Spin a mano porque la nativa viene rota. 8% confirmado por Leo
// (07/10/2026), verificado contra el cierre real de F coco (TeamBack Suprema, semana 238).
const SPIN_STAKES_HEADER = "Total Stakes Spin(Local)";
const SPIN_RAKE_PCT = 0.08;

// Opcionales: no bloquean la hoja si faltan (una variante del reporte de Suprema podría no
// traerlas), pero cuando están se usan para enriquecer la resolución de agente y para mostrar
// la jerarquía real (Role/Sub Agent) — NUNCA para reagrupar el resultado de un jugador: el
// resultado siempre se suma por "Agent Name" (el superagente), confirmado explícitamente por el
// usuario — el Sub Agent es solo información de a quién le reporta puertas adentro.
const OPTIONAL_HEADERS = ["Role", "Sub Agent ID", "Sub Agent Name", "Total Stakes Spin(Local)"] as const;

const RAKE_HEADERS = [
  "Ring Game Total(Local)",
  "MTT Total(Local)",
  "SNG Total(Local)",
  "TLT Total(Local)",
] as const;

export interface SupremaPlayerRow {
  playerId: string;
  playerName: string;
  agentIdRaw: string | null;
  agentNameRaw: string | null;
  resultado: number;
  rake: number;
  // Desglose del rake por tipo de juego — igual a las columnas "Ring Game"/"MTT"/"SNG"/"Spin"
  // del resumen semanal por club (ver repo/clubResumen.ts). ringGame+mtt+sngOtros+spin = rake
  // siempre. sngOtros junta SNG+TLT (el resumen de la planilla real tampoco los separa); Spin
  // va aparte (ver FIX 07/10/2026 #2) porque hay que reconstruirlo a mano y Leo pidió poder
  // verlo solo, en su propia columna, para chequear que el 8% da bien.
  ringGame?: number;
  mtt?: number;
  sngOtros?: number;
  spin?: number;
  // Solo Tiny GG (18/09/2026): "Bad Beat Jackpot > Contribution Fee" del reporte -- informativo,
  // nunca afecta el calculo del cierre de ningun agente. undefined para el resto de plataformas.
  bbjContribution?: number;
  rodeo: number;
  // Informativos (columnas opcionales) — no afectan el cálculo de plata, ver nota en
  // OPTIONAL_HEADERS. role: "MEMBER" | "AGENT" | "SUPERAGENT" tal cual lo manda Suprema.
  role: string | null;
  subAgentIdRaw: string | null;
  subAgentNameRaw: string | null;
}

export interface SupremaSheetParseError {
  sheetName: string;
  reason: string;
}

export interface SupremaParseResult {
  sheets: { sheetName: string; rows: SupremaPlayerRow[] }[];
  hojasIgnoradas: SupremaSheetParseError[];
}

function normText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(typeof v === "object" && v && "text" in (v as any) ? (v as any).text : v).trim();
  if (s === "" || s.toLowerCase() === "none") return null;
  return s;
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v && "result" in (v as any)) return Number((v as any).result) || 0;
  // Por si algún valor viene como string con coma decimal (formato local).
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : 0;
}

/**
 * Parsea el workbook completo. Cada hoja se intenta interpretar con el formato Suprema;
 * una hoja que no tenga los encabezados esperados se reporta en `hojasIgnoradas` en vez de
 * romper el resto del archivo (evita que una pestaña rara tire abajo la importación entera).
 */
export async function parseSupremaWorkbook(buffer: Buffer): Promise<SupremaParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const sheets: { sheetName: string; rows: SupremaPlayerRow[] }[] = [];
  const hojasIgnoradas: SupremaSheetParseError[] = [];

  for (const ws of wb.worksheets) {
    const headerRow = ws.getRow(1);
    const headerByCol = new Map<number, string>();
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = normText(cell.value);
      if (text) headerByCol.set(colNumber, text);
    });

    // Mapea cada encabezado requerido (y los opcionales, si están) a su número de columna
    // (primera ocurrencia).
    const colIndex: Record<string, number> = {};
    for (const [col, text] of headerByCol) {
      if (
        ((REQUIRED_HEADERS as readonly string[]).includes(text) || (OPTIONAL_HEADERS as readonly string[]).includes(text)) &&
        colIndex[text] === undefined
      ) {
        colIndex[text] = col;
      }
      if ((RODEO_HEADER_ALIASES as readonly string[]).includes(text) && colIndex[RODEO_KEY] === undefined) {
        colIndex[RODEO_KEY] = col;
      }
    }
    const faltantes = REQUIRED_HEADERS.filter((h) => colIndex[h] === undefined);
    if (colIndex[RODEO_KEY] === undefined) {
      faltantes.push(`${RODEO_HEADER_ALIASES[0]} (o su alias actual, ${RODEO_HEADER_ALIASES[1]})` as any);
    }
    if (faltantes.length > 0) {
      hojasIgnoradas.push({
        sheetName: ws.name,
        reason: `No tiene el formato Suprema esperado — faltan columnas: ${faltantes.join(", ")}.`,
      });
      continue;
    }

    const rows: SupremaPlayerRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // encabezado
      const playerId = normText(row.getCell(colIndex["Player ID"]).value);
      if (!playerId) return; // fila vacía / de borde
      const playerName = normText(row.getCell(colIndex["Player Name"]).value) ?? playerId;
      const agentIdRaw = normText(row.getCell(colIndex["Agent ID"]).value);
      const agentNameRaw = normText(row.getCell(colIndex["Agent Name"]).value);
      const resultado = toNumber(row.getCell(colIndex["Total(Local)"]).value);
      const ringGame = toNumber(row.getCell(colIndex["Ring Game Total(Local)"]).value);
      const mtt = toNumber(row.getCell(colIndex["MTT Total(Local)"]).value);
      const sngOtros =
        toNumber(row.getCell(colIndex["SNG Total(Local)"]).value) +
        toNumber(row.getCell(colIndex["TLT Total(Local)"]).value);
      // Spin (ver FIX 07/10/2026 #2 arriba): si el archivo trae la columna nueva de stakes se
      // usa SIEMPRE el calculo (8% del stake, confirmado por Leo) -- la columna nativa
      // "SPIN Total(Local)" viene rota (en 0) desde este cambio de reporte. Fallback al valor
      // nativo solo para poder re-parsear un archivo viejo que no tenga la columna de stakes.
      const spin =
        colIndex[SPIN_STAKES_HEADER] !== undefined
          ? toNumber(row.getCell(colIndex[SPIN_STAKES_HEADER]).value) * SPIN_RAKE_PCT
          : toNumber(row.getCell(colIndex["SPIN Total(Local)"]).value);
      const rake = RAKE_HEADERS.reduce((sum, h) => sum + toNumber(row.getCell(colIndex[h]).value), 0) + spin;
      const rodeo = toNumber(row.getCell(colIndex[RODEO_KEY]).value);
      const role = colIndex["Role"] !== undefined ? normText(row.getCell(colIndex["Role"]).value) : null;
      const subAgentIdRaw = colIndex["Sub Agent ID"] !== undefined ? normText(row.getCell(colIndex["Sub Agent ID"]).value) : null;
      const subAgentNameRaw = colIndex["Sub Agent Name"] !== undefined ? normText(row.getCell(colIndex["Sub Agent Name"]).value) : null;
      rows.push({ playerId, playerName, agentIdRaw, agentNameRaw, resultado, rake, ringGame, mtt, sngOtros, spin, rodeo, role, subAgentIdRaw, subAgentNameRaw });
    });

    sheets.push({ sheetName: ws.name, rows });
  }

  return { sheets, hojasIgnoradas };
}
