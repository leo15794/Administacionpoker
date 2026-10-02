// Diagnóstico de arranque para cuentas de socio tipo "Juan" (person_key en agents, ver
// aplicarCierreCompensacionPersonaTx en repo/closings.ts) -- 100% de LECTURA, no toca nada.
// Caso 02/10/2026: Leo vinculó identidades de club a los socios "Manos" y "Fede" (campo "Cuenta
// de socio" en Agentes) que YA tenían cierres aplicados como agentes normales antes de ese
// cambio -- hay que migrar ese saldo acumulado a Cuentas de socios con el mismo criterio que ya
// usa el enganche automático de cierres nuevos.
//
// Para cada agente con ese person_key muestra:
//   - balances.amount por club (convención de la app: positivo = a favor del agente)
//   - resultado acumulado de mesas PREPAGO (mismo ajuste que ya usa fichas reales en todos
//     lados -- ver diagnosticoSaldoSupervisor.ts)
//   - FICHAS REALES = balance + mesas
//   - el monto a cargar en partner_account_entries, que usa la convención INVERTIDA de la
//     cuenta de socio ("positivo = el socio le debe a la empresa", ver aplicarCierreCompensacion-
//     PersonaTx: amount = -finalClosing) -- por eso acá el catch-up es -FICHAS_REALES.
//
// También avisa si la cuenta de socio ya existe y si ya tiene movimientos (para no duplicar un
// catch-up que ya se cargó).
//
// Uso: tsx src/scripts/diagnosticoSaldoCuentaSocio.ts manos fede
import { pool } from "../db/pool.js";

function fmt(n: number) {
  return (n < 0 ? "-US$ " : "US$ ") + Math.abs(n).toFixed(2);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const personKeys = process.argv.slice(2).map((s) => s.toLowerCase().trim()).filter(Boolean);
  if (personKeys.length === 0) {
    console.log('Uso: tsx src/scripts/diagnosticoSaldoCuentaSocio.ts <person_key> [person_key...]');
    console.log('Ej:  tsx src/scripts/diagnosticoSaldoCuentaSocio.ts manos fede');
    await pool.end();
    return;
  }

  for (const personKey of personKeys) {
    console.log(`\n\n######## person_key = "${personKey}" ########`);

    const cuenta = await pool.query(`SELECT * FROM partner_accounts WHERE lower(name) = $1`, [personKey]);
    if (!cuenta.rows[0]) {
      console.log(`  ATENCIÓN: no existe ninguna cuenta de socio con nombre "${personKey}" (ni activa ni inactiva).`);
      console.log(`  Hay que crearla en Cuentas de socios ANTES de aplicar cualquier cierre nuevo de estos agentes.`);
    } else {
      const c = cuenta.rows[0];
      const movs = await pool.query(
        `SELECT COUNT(*)::int as cantidad, COALESCE(SUM(amount),0) as saldo FROM partner_account_entries WHERE account_id = $1`,
        [c.id]
      );
      console.log(`  Cuenta de socio "${c.name}" ya existe (id=${c.id}, active=${c.active}).`);
      console.log(`  Ya tiene ${movs.rows[0].cantidad} movimiento(s) cargado(s), saldo actual = ${fmt(Number(movs.rows[0].saldo))}.`);
      if (Number(movs.rows[0].cantidad) > 0) {
        console.log(`  OJO: si ya corriste un catch-up para esta cuenta antes, no lo vuelvas a cargar -- revisá los movimientos en Cuentas de socios primero.`);
      }
    }

    const agentesRes = await pool.query(
      `SELECT * FROM agents WHERE person_key = $1 ORDER BY name`,
      [personKey]
    );
    console.log(`\n  Agentes con person_key="${personKey}": ${agentesRes.rows.length}`);
    if (agentesRes.rows.length === 0) {
      console.log(`  (ninguno -- revisá que "Cuenta de socio" esté bien escrito en Agentes, tiene que ser EXACTO "${personKey}")`);
      continue;
    }

    let totalFichasReales = 0;
    const lineas: { agentId: string; agentName: string; fichasReales: number; totalHistorico: number; cantidadCierres: number }[] = [];

    for (const ag of agentesRes.rows) {
      console.log(`\n  --- ${ag.name} (id=${ag.id}, active=${ag.active}, default_system=${ag.default_system}) ---`);

      const bal = await pool.query(
        `SELECT b.amount, c.name as club_name FROM balances b JOIN clubs c ON c.id = b.club_id
         WHERE b.agent_id = $1 AND b.amount <> 0 ORDER BY c.name`,
        [ag.id]
      );
      let balanceAgente = 0;
      if (bal.rows.length === 0) {
        console.log("    balances (crudo): (sin saldo de fichas)");
      }
      for (const b of bal.rows) {
        console.log(`    balances (crudo) -- ${b.club_name}: ${fmt(Number(b.amount))}`);
        balanceAgente += Number(b.amount);
      }

      const mesas = await pool.query(
        `SELECT COALESCE(SUM(result), 0) as total_mesas FROM weekly_closings
         WHERE agent_id = $1 AND system = 'PREPAGO' AND status <> 'REVERTIDO'`,
        [ag.id]
      );
      const totalMesas = Number(mesas.rows[0].total_mesas);
      const fichasReales = balanceAgente + totalMesas;
      console.log(`    resultado acumulado de mesas (PREPAGO): ${fmt(totalMesas)}`);
      console.log(`    FICHAS REALES (balance + mesas, a favor del agente si es positivo) = ${fmt(fichasReales)}`);
      console.log(`    --> catch-up si se usa el balance actual (signo invertido) = ${fmt(-fichasReales)}`);

      // OJO (02/10/2026, caso Fede/patoruzit0): el balance actual puede estar en 0 aunque haya
      // historia real -- si cada semana se carga y se descarga, el balance se resetea solo. Para
      // saber cuánto ganó/perdió ese agente EN TOTAL desde que juega (sin importar si ya se le
      // cargó/descargó físicamente), hay que sumar final_closing de TODOS sus cierres, no mirar
      // el balance. Esta es la misma cantidad que usa el enganche automático en vivo (ver
      // aplicarCierreCompensacionPersonaTx: amount = -finalClosing, por eso el mismo signo acá).
      const historico = await pool.query(
        `SELECT COALESCE(SUM(final_closing), 0) as total, COUNT(*)::int as cantidad,
                MIN(week_start) as desde, MAX(week_start) as hasta
         FROM weekly_closings WHERE agent_id = $1 AND status <> 'REVERTIDO'`,
        [ag.id]
      );
      const h = historico.rows[0];
      const totalHistorico = Number(h.total);
      console.log(`    resultado acumulado HISTÓRICO de TODOS los cierres (final_closing, ${h.cantidad} cierre(s)${h.desde ? `, ${h.desde}..${h.hasta}` : ""}) = ${fmt(totalHistorico)}`);
      console.log(`    --> catch-up si se usa el histórico completo (signo invertido) = ${fmt(-totalHistorico)}  <-- probablemente este es el que corresponde`);

      totalFichasReales += fichasReales;

      lineas.push({ agentId: ag.id, agentName: ag.name, fichasReales: round2(fichasReales), totalHistorico: round2(totalHistorico), cantidadCierres: h.cantidad });
    }

    console.log(`\n  === TOTAL a migrar para "${personKey}" ===`);
    console.log(`  Suma fichas reales de todos sus agentes = ${fmt(totalFichasReales)}`);
    console.log(`  Catch-up total a cargar en la cuenta de socio (signo invertido) = ${fmt(-totalFichasReales)}`);

    console.log(`\n  === LINEAS (para pegarle a Claude) ===`);
    for (const l of lineas) {
      console.log(`    ${l.agentId} | ${l.agentName} | fichasReales=${l.fichasReales} | historico(${l.cantidadCierres} cierres)=${l.totalHistorico} | catchUpHistorico=${round2(-l.totalHistorico)}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
