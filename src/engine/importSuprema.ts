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
  "Total Profit Rodeo(Local)",
] as const;

// Opcionales: no bloquean la hoja si faltan (una variante del reporte de Suprema podría no
// traerlas), pero cuando están se usan para enriquecer la resolución de agente y para mostrar
// la jerarquía real (Role/Sub Agent) — NUNCA para reagrupar el resultado de un jugador: el
// resultado siempre se suma por "Agent Name" (el superagente), confirmado explícitamente por el
// usuario — el Sub Agent es solo información de a quién le reporta puertas adentro.
const OPTIONAL_HEADERS = ["Role", "Sub Agent ID", "Sub Agent Name"] as const;

const RAKE_HEADERS = [
  "Ring Game Total(Local)",
  "MTT Total(Local)",
  "SNG Total(Local)",
  "SPIN Total(Local)",
  "TLT Total(Local)",
] as const;

export interface SupremaPlayerRow {
  playerId: string;
  playerName: string;
  agentIdRaw: string | null;
  agentNameRaw: string | null;
  resultado: number;
  rake: number;
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
    }
    const faltantes = REQUIRED_HEADERS.filter((h) => colIndex[h] === undefined);
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
      const rake = RAKE_HEADERS.reduce((sum, h) => sum + toNumber(row.getCell(colIndex[h]).value), 0);
      const rodeo = toNumber(row.getCell(colIndex["Total Profit Rodeo(Local)"]).value);
      const role = colIndex["Role"] !== undefined ? normText(row.getCell(colIndex["Role"]).value) : null;
      const subAgentIdRaw = colIndex["Sub Agent ID"] !== undefined ? normText(row.getCell(colIndex["Sub Agent ID"]).value) : null;
      const subAgentNameRaw = colIndex["Sub Agent Name"] !== undefined ? normText(row.getCell(colIndex["Sub Agent Name"]).value) : null;
      rows.push({ playerId, playerName, agentIdRaw, agentNameRaw, resultado, rake, rodeo, role, subAgentIdRaw, subAgentNameRaw });
    });

    sheets.push({ sheetName: ws.name, rows });
  }

  return { sheets, hojasIgnoradas };
}
