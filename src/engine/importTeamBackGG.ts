// Importador de cierres — formato "TeamBack GG" (plataforma GG Poker, club "TeamBack GG" en
// el catálogo — NO confundir con "Fénix GG", que usa una carga distinta y más simple, ni con
// "TeamBack Suprema", que es la plataforma SupremaPoker con otro formato de archivo).
// Motor PURO (sin DB, sin red): dado el buffer de un .xlsx, devuelve filas ya normalizadas con
// la MISMA forma que engine/importSuprema.ts (SupremaPlayerRow) para poder reusar sin cambios
// toda la resolución de agente y el motor de cálculo de cierre ya verificados (ver
// repo/importsTeamBackGG.ts y repo/imports.ts::resolvePlayerAgent).
//
// Formato real (reporte oficial de GG Poker/TeamBack, exportado a Excel):
//   Fila 1: "Club name: <nombre>" · Fila 2: "Club ID: <id>" · Fila 3: "Period: <rango de fechas>"
//   Filas 4-6: encabezado jerárquico de 3 niveles con celdas combinadas (Super Agent/Agent/
//   Member en columnas A-J; luego grupos de plata: Player P&L, Rake&Fee, Insurance, EV Cashout,
//   Squid Game, etc., cada uno desglosado por variante de juego + una columna "Total" del grupo).
//   Filas de datos: una por "Member" (puede ser Role=Player, Agent o Super Agent).
//   Última fila: "TOTAL" — fila de control, se excluye de los datos y se usa para verificar que
//   la suma de las filas parseadas coincide (si no coincide, la hoja se rechaza en vez de
//   importar números que no cierran).
//
// Fórmula de cierre verificada contra la hoja RESUMEN_GG del sheet real (agente "El Latigo
// Loco" y otros, semana del 31/08 al 06/09/2026):
//   Resultado agente = suma de "Player P&L Total" de sus jugadores.
//   Rake agente      = suma de "Rake&Fee Total" de sus jugadores.
//   (El rakeback/rebate se calculan después, en el motor genérico calcularCierre — ver
//   repo/importsTeamBackGG.ts — con rebatePct NEGATIVO por convención de este club: confirmado
//   explícitamente por el usuario que la fórmula es Rebate = (W/L + Rake) × -0,10).
// No hay equivalente a "Rodeo" en este formato — siempre 0.
import ExcelJS from "exceljs";
import type { SupremaPlayerRow } from "./importSuprema.js";

export interface TeamBackGGSheetParseError {
  sheetName: string;
  reason: string;
}

export interface TeamBackGGParseResult {
  sheets: { sheetName: string; rows: SupremaPlayerRow[] }[];
  hojasIgnoradas: TeamBackGGSheetParseError[];
}

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
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : 0;
}

// Lee el valor de una celda resolviendo el merge (una celda combinada solo tiene .value en la
// celda superior-izquierda del rango — .master siempre apunta ahí, y es la propia celda si no
// está combinada). Esto reemplaza el "forward-fill" manual de encabezados con merge.
function masterText(ws: ExcelJS.Worksheet, row: number, col: number): string | null {
  const cell = ws.getCell(row, col);
  const master = (cell as any).master ?? cell;
  return normText(master.value);
}

const IDENTITY_COLS = [
  { group: "super agent", specific: "id", field: "superAgentId" as const },
  { group: "super agent", specific: "nickname", field: "superAgentNickname" as const },
  { group: "agent", specific: "id", field: "agentId" as const },
  { group: "agent", specific: "nickname", field: "agentNickname" as const },
  { group: "member", specific: "role", field: "memberRole" as const },
  { group: "member", specific: "id", field: "memberId" as const },
  { group: "member", specific: "nickname", field: "memberNickname" as const },
];

/**
 * Detecta la fila donde termina el encabezado jerárquico (3 filas) buscando la celda "No."
 * (columna de número de fila) entre las primeras 10 filas — el encabezado real son esa fila y
 * las 2 anteriores. Devuelve null si no la encuentra (hoja con formato inesperado).
 */
function detectarFilaFinEncabezado(ws: ExcelJS.Worksheet): number | null {
  // La celda "No." está combinada verticalmente a lo largo de las 3 filas de encabezado (su
  // master da el mismo texto en cada una) — se busca de ABAJO hacia arriba para quedarse con la
  // ÚLTIMA fila del encabezado, no la primera fila del merge.
  for (let r = 10; r >= 1; r--) {
    for (let c = 1; c <= 5; c++) {
      const t = normText(ws.getCell(r, c).value);
      if (t && t.toLowerCase() === "no.") return r;
    }
  }
  return null;
}

/**
 * Busca, dentro del rango de columnas del encabezado, la columna "Total" de un grupo dado
 * (ej. "player p&l" -> Player P&L Total, "rake" -> Rake&Fee Total). Recorre las 3 filas de
 * encabezado con masterText (ya resuelve merges) y matchea por texto parcial case-insensitive.
 */
function buscarColumnaTotalDeGrupo(
  ws: ExcelJS.Worksheet,
  filaFinEncabezado: number,
  maxCol: number,
  grupoContiene: string
): number | null {
  const filaInicio = filaFinEncabezado - 2;
  for (let c = 1; c <= maxCol; c++) {
    const niveles = [
      masterText(ws, filaInicio, c),
      masterText(ws, filaInicio + 1, c),
      masterText(ws, filaFinEncabezado, c),
    ].filter((x): x is string => !!x);
    if (niveles.length === 0) continue;
    const grupo = niveles[0]!.toLowerCase();
    const especifico = niveles[niveles.length - 1]!.toLowerCase();
    if (grupo.includes(grupoContiene) && especifico === "total") return c;
  }
  return null;
}

function buscarColumnaIdentidad(
  ws: ExcelJS.Worksheet,
  filaFinEncabezado: number,
  maxCol: number,
  grupo: string,
  especifico: string
): number | null {
  const filaInicio = filaFinEncabezado - 2;
  for (let c = 1; c <= maxCol; c++) {
    const niveles = [
      masterText(ws, filaInicio, c),
      masterText(ws, filaInicio + 1, c),
      masterText(ws, filaFinEncabezado, c),
    ].filter((x): x is string => !!x);
    if (niveles.length < 2) continue;
    const g = niveles[0]!.toLowerCase();
    const e = niveles[niveles.length - 1]!.toLowerCase();
    if (g === grupo && e === especifico) return c;
  }
  return null;
}

export async function parseTeamBackGGWorkbook(buffer: Buffer): Promise<TeamBackGGParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const sheets: { sheetName: string; rows: SupremaPlayerRow[] }[] = [];
  const hojasIgnoradas: TeamBackGGSheetParseError[] = [];

  for (const ws of wb.worksheets) {
    const filaFinEncabezado = detectarFilaFinEncabezado(ws);
    if (!filaFinEncabezado) {
      hojasIgnoradas.push({
        sheetName: ws.name,
        reason: 'No tiene el formato TeamBack GG esperado — no se encontró la columna "No." del encabezado de 3 niveles.',
      });
      continue;
    }

    const maxCol = ws.columnCount || 200;
    const colSuperAgentId = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "super agent", "id");
    const colSuperAgentNick = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "super agent", "nickname");
    const colAgentId = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "agent", "id");
    const colAgentNick = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "agent", "nickname");
    const colMemberRole = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "member", "role");
    const colMemberId = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "member", "id");
    const colMemberNick = buscarColumnaIdentidad(ws, filaFinEncabezado, maxCol, "member", "nickname");
    const colResultado = buscarColumnaTotalDeGrupo(ws, filaFinEncabezado, maxCol, "p&l");
    const colRake = buscarColumnaTotalDeGrupo(ws, filaFinEncabezado, maxCol, "rake");

    const faltantes: string[] = [];
    if (!colMemberId) faltantes.push("Member ID");
    if (!colMemberNick) faltantes.push("Member Nickname");
    if (!colResultado) faltantes.push("Player P&L Total");
    if (!colRake) faltantes.push("Rake&Fee Total");
    if (faltantes.length > 0) {
      hojasIgnoradas.push({
        sheetName: ws.name,
        reason: `No tiene el formato TeamBack GG esperado — no se encontraron estas columnas: ${faltantes.join(", ")}.`,
      });
      continue;
    }

    const rows: SupremaPlayerRow[] = [];
    let totalRow: ExcelJS.Row | null = null;
    let sumaResultado = 0;
    let sumaRake = 0;

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= filaFinEncabezado) return; // encabezado
      const primeraCelda = normText(row.getCell(2).value) ?? normText(row.getCell(1).value);
      if (primeraCelda && primeraCelda.toUpperCase() === "TOTAL") {
        totalRow = row;
        return;
      }

      const memberId = normText(row.getCell(colMemberId!).value);
      if (!memberId) return; // fila vacía / de borde

      const memberNick = normText(row.getCell(colMemberNick!).value) ?? memberId;
      const superAgentId = colSuperAgentId ? normText(row.getCell(colSuperAgentId).value) : null;
      const superAgentNick = colSuperAgentNick ? normText(row.getCell(colSuperAgentNick).value) : null;
      const agentIdCol = colAgentId ? normText(row.getCell(colAgentId).value) : null;
      const agentNickCol = colAgentNick ? normText(row.getCell(colAgentNick).value) : null;
      const memberRole = colMemberRole ? normText(row.getCell(colMemberRole).value) : null;
      const resultado = toNumber(row.getCell(colResultado!).value);
      const rake = toNumber(row.getCell(colRake!).value);

      // El "agente" para plata es SIEMPRE el Super Agent (el nivel más alto de la cadena) —
      // mismo principio que Suprema: el resultado se agrupa por el superagente, nunca por un
      // sub-nivel. Si esta fila NO tiene Super Agent (columna vacía/"-"), puede ser porque la
      // fila ES el propio Super Agent (Role = "Super Agent") — en ese caso su identidad de
      // Member es la que se usa como agente. Si tampoco es Super Agent, no hay ninguna cadena
      // de agente en esta fila y queda "sin agente" (igual que Suprema con Agent Name vacío).
      let agentIdRaw: string | null;
      let agentNameRaw: string | null;
      if (superAgentId || superAgentNick) {
        agentIdRaw = superAgentId;
        agentNameRaw = superAgentNick;
      } else if (memberRole && memberRole.toLowerCase() === "super agent") {
        agentIdRaw = memberId;
        agentNameRaw = memberNick;
      } else if (agentIdCol || agentNickCol) {
        // Fallback defensivo: tiene Agent pero no Super Agent (no debería pasar en la jerarquía
        // real, pero si pasa es mejor agrupar por el Agent que perder la plata como "sin agente").
        agentIdRaw = agentIdCol;
        agentNameRaw = agentNickCol;
      } else {
        agentIdRaw = null;
        agentNameRaw = null;
      }

      sumaResultado += resultado;
      sumaRake += rake;
      rows.push({
        playerId: memberId,
        playerName: memberNick,
        agentIdRaw,
        agentNameRaw,
        resultado,
        rake,
        rodeo: 0, // no existe equivalente a "Rodeo" en este formato
        role: memberRole,
        subAgentIdRaw: agentIdCol,
        subAgentNameRaw: agentNickCol,
      });
    });

    // Control cruzado contra la fila TOTAL del archivo (si existe): si la plataforma cambia el
    // layout del reporte sin avisar, esto evita importar números que no cierran en silencio —
    // se rechaza la hoja entera y se pide revisión manual, en vez de aplicar un cierre mal
    // calculado.
    if (totalRow) {
      const totalResultado = toNumber((totalRow as ExcelJS.Row).getCell(colResultado!).value);
      const totalRake = toNumber((totalRow as ExcelJS.Row).getCell(colRake!).value);
      const EPS = 0.02;
      if (Math.abs(totalResultado - sumaResultado) > EPS || Math.abs(totalRake - sumaRake) > EPS) {
        hojasIgnoradas.push({
          sheetName: ws.name,
          reason: `La suma de las filas no coincide con la fila TOTAL del archivo (resultado: ${sumaResultado} vs ${totalResultado}; rake: ${sumaRake} vs ${totalRake}) — puede que el formato del reporte haya cambiado. Revisar a mano antes de importar.`,
        });
        continue;
      }
    }

    sheets.push({ sheetName: ws.name, rows });
  }

  return { sheets, hojasIgnoradas };
}
