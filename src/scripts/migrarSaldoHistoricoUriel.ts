// Migración histórica de arranque para la cuenta consolidada de Uriel (01/10/2026). UNA SOLA
// VEZ: mueve lo que sus 9 agentes ya tenían acumulado (FICHAS REALES = balance + resultado
// acumulado de mesas PREPAGO, + rakeback_pendiente activo -- según la corrida de
// diagnosticoSaldoSupervisor.ts del 01/10/2026) a la cuenta consolidada nueva, dejando
// registro línea por línea en supervisor_migracion_historica. NO toca balances ni
// rakeback_pendiente de los agentes de origen -- quedan tal cual, como stock de lectura/
// auditoría (ver repo/supervisores.ts, migrarSaldoHistoricoSupervisor). Se corta solo si la
// cuenta de Uriel ya tiene saldo (evita correr esto dos veces por error).
//
// Uso: npx tsx src/scripts/migrarSaldoHistoricoUriel.ts
import { pool } from "../db/pool.js";
import { migrarSaldoHistoricoSupervisor, type LineaMigracionHistorica } from "../repo/supervisores.js";

const LINEAS: (LineaMigracionHistorica & { agentName: string; clubName: string | null })[] = [
  { agentId: "agent_41yedjr8mtuip1fj", agentName: "BestiaPop!", fichasMigradas: 1647.76, pendienteMigrado: 0, clubName: "TeamBack GG" },
  { agentId: "agent_o2bq5ud8mtsqfhn0", agentName: "Dejodita", fichasMigradas: -50, pendienteMigrado: 0, clubName: "Fénix GG" },
  { agentId: "agent_jwpuvuxamtsqfhrq", agentName: "Demiurge29", fichasMigradas: 0, pendienteMigrado: 0, clubName: null },
  { agentId: "agent_nx1rfu9jmtsqfiz2", agentName: "JereStack", fichasMigradas: 6980.9, pendienteMigrado: 311.48, clubName: "TeamBack GG" },
  { agentId: "agent_eg67ng0umtsw04by", agentName: "Jinx Wang Chan", fichasMigradas: 0, pendienteMigrado: 0, clubName: null },
  { agentId: "agent_n99ndaszmtsqfl40", agentName: "MutiladorDoc", fichasMigradas: 0, pendienteMigrado: 0, clubName: null },
  { agentId: "agent_yaz8mp5gmtsqfkg8", agentName: "QueDificil", fichasMigradas: 5715.37, pendienteMigrado: 1100.22, clubName: "TeamBack GG" },
  { agentId: "agent_vkhlbeismtsw04lb", agentName: "Quintero100", fichasMigradas: 5935.02, pendienteMigrado: 309.08, clubName: "TeamBack GG" },
  { agentId: "agent_lijri6qkmtsw03ez", agentName: "todorojo", fichasMigradas: 0, pendienteMigrado: 0, clubName: null },
];

async function main() {
  const sup = await pool.query(`SELECT * FROM agents WHERE name ILIKE 'Uriel'`);
  if (!sup.rows[0]) {
    console.log('No se encontró ningún agente llamado "Uriel".');
    await pool.end();
    return;
  }
  const supervisor = sup.rows[0];
  if (!supervisor.usa_cuenta_consolidada) {
    console.log(`"${supervisor.name}" todavía no tiene usa_cuenta_consolidada=true. Activalo en Administración antes de migrar.`);
    await pool.end();
    return;
  }

  const yaTieneCuenta = await pool.query(`SELECT * FROM supervisor_cuentas WHERE supervisor_agent_id = $1`, [supervisor.id]);
  if (yaTieneCuenta.rows[0] && (Number(yaTieneCuenta.rows[0].fichas_reales) !== 0 || Number(yaTieneCuenta.rows[0].cuenta_corriente) !== 0)) {
    console.log(`ABORTADO: "${supervisor.name}" YA tiene saldo en supervisor_cuentas (fichas_reales=${yaTieneCuenta.rows[0].fichas_reales}, cuenta_corriente=${yaTieneCuenta.rows[0].cuenta_corriente}). Este script es de un solo uso -- si hace falta corregir algo, usá un movimiento de Ajuste manual desde la pantalla de Supervisores en vez de volver a correr esto.`);
    await pool.end();
    return;
  }

  const clubsRes = await pool.query(`SELECT id, name FROM clubs`);
  const clubIdPorNombre = new Map(clubsRes.rows.map((c) => [c.name, c.id]));

  console.log(`\nMigrando a "${supervisor.name}" (id=${supervisor.id}):`);
  let totalFichas = 0;
  let totalPendiente = 0;
  const lineasConClub: LineaMigracionHistorica[] = [];
  for (const l of LINEAS) {
    const clubId = l.clubName ? clubIdPorNombre.get(l.clubName) ?? null : null;
    if (l.clubName && !clubId) {
      console.log(`  AVISO: no encontré el club "${l.clubName}" para ${l.agentName} -- esa línea queda sin club_id (solo afecta la trazabilidad, no los montos).`);
    }
    console.log(`  - ${l.agentName}: fichas=US$ ${l.fichasMigradas.toFixed(2)} pendiente=US$ ${l.pendienteMigrado.toFixed(2)}`);
    totalFichas += l.fichasMigradas;
    totalPendiente += l.pendienteMigrado;
    lineasConClub.push({
      agentId: l.agentId,
      clubId,
      fichasMigradas: l.fichasMigradas,
      pendienteMigrado: l.pendienteMigrado,
      notes: `Saldo histórico traído desde la cuenta individual de ${l.agentName} al activar la cuenta consolidada de ${supervisor.name} (01/10/2026).`,
    });
  }
  console.log(`  TOTAL fichas_reales a migrar: US$ ${totalFichas.toFixed(2)}`);
  console.log(`  TOTAL cuenta_corriente a migrar: US$ ${totalPendiente.toFixed(2)}`);

  const result = await migrarSaldoHistoricoSupervisor(supervisor.id, lineasConClub, "script-migracion-uriel-01-10-2026");
  console.log(`\nOK. Cuenta de "${supervisor.name}" quedó: fichas_reales=US$ ${result.fichasTotal.toFixed(2)} cuenta_corriente=US$ ${result.ccTotal.toFixed(2)} saldo_total=US$ ${(result.fichasTotal + result.ccTotal).toFixed(2)}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
