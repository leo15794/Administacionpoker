// Verifica calcularSaldoFinanciero (repo/ledger.ts) contra los 7 casos de prueba de Leo.
// No necesita conexion a la base -- es una funcion pura. Los casos 6 y 7 (union con
// rakeback_pendiente sin fila en balances / pendiente agotado no debe aparecer) son
// garantias de la consulta SQL en listSaldoFinancieroPorAgenteClub, no de esta funcion --
// se documentan aparte abajo, revisados por lectura de la query.
import { calcularSaldoFinanciero } from "../repo/ledger.js";

let fallos = 0;
function assertEq(label: string, actual: number, esperado: number) {
  const ok = Math.abs(actual - esperado) < 0.005;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: esperado ${esperado}, obtuvo ${actual}`);
  if (!ok) fallos++;
}

// Caso 1: WIN_LOSE con 1000 fichas operativas y 100 de cierre pendiente -> KPI = 100, no 1100.
assertEq("Caso 1 (WIN_LOSE 1000 fichas + 100 pendiente)", calcularSaldoFinanciero("WIN_LOSE", 1000, 100), 100);

// Caso 2: PREPAGO con 500 fichas reales y 50 de cierre pendiente -> KPI = 550.
assertEq("Caso 2 (PREPAGO 500 fichas + 50 pendiente)", calcularSaldoFinanciero("PREPAGO", 500, 50), 550);

// Caso 3: pago de 100 del pendiente en fichas (PREPAGO) -- baja 100 el pendiente, suben 100
// las fichas -- la exposicion financiera total NO cambia.
{
  const antes = calcularSaldoFinanciero("PREPAGO", 500, 100);
  const despues = calcularSaldoFinanciero("PREPAGO", 500 + 100, 100 - 100);
  assertEq("Caso 3 (PREPAGO, pago 100 en fichas, no cambia exposicion)", despues, antes);
}

// Caso 4: pago de 100 en USDT -- baja 100 el pendiente, la wallet baja 100 aparte (no es
// parte de esta funcion), la exposicion financiera total SI disminuye 100 -- para los dos
// sistemas.
{
  const antesWL = calcularSaldoFinanciero("WIN_LOSE", 1000, 300);
  const despuesWL = calcularSaldoFinanciero("WIN_LOSE", 1000, 300 - 100);
  assertEq("Caso 4a (WIN_LOSE, pago 100 en USDT, exposicion baja 100)", antesWL - despuesWL, 100);

  const antesPP = calcularSaldoFinanciero("PREPAGO", 500, 300);
  const despuesPP = calcularSaldoFinanciero("PREPAGO", 500, 300 - 100);
  assertEq("Caso 4b (PREPAGO, pago 100 en USDT, exposicion baja 100)", antesPP - despuesPP, 100);
}

// Caso 5: una carga/descarga operativa WIN_LOSE puede mover balances.amount (fichas), pero
// NUNCA debe mover el KPI financiero.
{
  const conMenosFichas = calcularSaldoFinanciero("WIN_LOSE", 200, 50);
  const conMasFichas = calcularSaldoFinanciero("WIN_LOSE", 5000, 50);
  assertEq("Caso 5 (WIN_LOSE, carga/descarga no mueve el KPI)", conMasFichas, conMenosFichas);
}

console.log("");
console.log("Casos 6 y 7 (union con rakeback_pendiente sin balance / pendiente agotado no");
console.log("aparece) dependen de la consulta SQL, no de esta funcion pura -- verificados por");
console.log("lectura de listSaldoFinancieroPorAgenteClub en repo/ledger.ts:");
console.log("  - Caso 6: la CTE `combos` es UNION de (SELECT agent_id, club_id FROM balances) y");
console.log("    (SELECT agent_id, club_id FROM rakeback_pendiente WHERE active=true AND");
console.log("    amount>consumed) -- un supervisor con pendiente activo pero sin fila en");
console.log("    `balances` SI genera su propia fila via la segunda rama del UNION.");
console.log("  - Caso 7: tanto `combos` como `pendiente_agg` filtran WHERE active=true AND");
console.log("    amount>consumed -- un pendiente ya consumido del todo o inactivo no aporta ni");
console.log("    genera fila por si solo (aporta 0 si el agente+club ya existe por balance).");
console.log("No pude correr esto contra la base real -- no hay ruta de red a Neon desde este");
console.log("shell (confirmado). Si Leo puede correr una consulta de lectura contra un caso");
console.log("real de supervisor con pendiente sin balance, se puede confirmar en vivo.");

console.log("");
if (fallos > 0) {
  console.log(`${fallos} caso(s) fallaron.`);
  process.exit(1);
} else {
  console.log("Todos los casos verificables (1-5) pasaron.");
}
