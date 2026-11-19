import { pool } from "../db/pool.js";
import { esSupervisorWinLose, listSaldosPorAgenteSupervisor } from "./supervisores.js";

// Dar de baja un agente que ya no trabaja (19/11/2026, pedido de Leo, mockup 99). Nunca borra nada: active=false +
// baja_at, y el agente deja de aparecer en las listas del día a día. Solo se permite con todo en 0, así no desaparece
// plata de los totales: primero se salda con un pago o cobro.

let columnasListas = false;
async function asegurarColumnas() {
  if (columnasListas) return;
  await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS baja_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS desactivado_por_baja BOOLEAN NOT NULL DEFAULT FALSE`);
  columnasListas = true;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ChequeoBaja {
  agentId: string;
  name: string;
  saldos: { donde: string; monto: number }[];
  bloqueos: string[];
  puede: boolean;
}

export async function chequeoBajaAgente(agentId: string): Promise<ChequeoBaja | null> {
  const ag = (await pool.query(`SELECT * FROM agents WHERE id = $1`, [agentId])).rows[0];
  if (!ag) return null;
  const saldos: { donde: string; monto: number }[] = [];
  const bloqueos: string[] = [];

  // Agentes a cargo todavía activos (un supervisor no se da de baja con su gente adentro).
  const subs = await pool.query(`SELECT name FROM agents WHERE supervisor = $1 AND active = true ORDER BY name`, [ag.name]);
  if (subs.rows.length > 0) {
    const nombres = subs.rows.slice(0, 4).map((x: any) => x.name).join(", ");
    bloqueos.push(`Tiene ${subs.rows.length} agente${subs.rows.length === 1 ? "" : "s"} a cargo activo${subs.rows.length === 1 ? "" : "s"} (${nombres}${subs.rows.length > 4 ? "…" : ""}). Primero dalos de baja o pasalos a otro supervisor.`);
  }

  // Cuenta propia (Agentes / Supervisores).
  let enCuenta = false;
  if (ag.usa_cuenta_consolidada) {
    const sc = (await pool.query(`SELECT fichas_reales, cuenta_corriente FROM supervisor_cuentas WHERE supervisor_agent_id = $1`, [agentId])).rows[0];
    if (sc) {
      enCuenta = true;
      if (!esSupervisorWinLose(ag)) saldos.push({ donde: "Fichas reales", monto: r2(Number(sc.fichas_reales)) });
      saldos.push({ donde: "Cuenta corriente", monto: r2(Number(sc.cuenta_corriente)) });
    }
  }

  // Dentro de la cuenta de su supervisor (si tiene cuenta consolidada).
  if (ag.supervisor) {
    const sup = (await pool.query(`SELECT id, name, usa_cuenta_consolidada FROM agents WHERE name = $1`, [ag.supervisor])).rows[0];
    if (sup?.usa_cuenta_consolidada) {
      enCuenta = true;
      const fila = (await listSaldosPorAgenteSupervisor(sup.id)).find((f) => f.agentId === agentId);
      if (fila) saldos.push({ donde: `Cuenta de ${sup.name}`, monto: r2(Number(fila.saldoReal)) });
    }
  }

  // Saldo del sistema de siempre (Administración), solo si no vive en una cuenta consolidada.
  if (!enCuenta) {
    const s = (
      await pool.query(
        `SELECT COALESCE((SELECT SUM(amount) FROM balances WHERE agent_id = $1), 0)
              + COALESCE((SELECT SUM(result) FROM weekly_closings WHERE agent_id = $1 AND system = 'PREPAGO' AND status <> 'REVERTIDO'), 0) AS saldo`,
        [agentId]
      )
    ).rows[0];
    saldos.push({ donde: "Saldo", monto: r2(Number(s.saldo)) });
  }

  const rb = (
    await pool.query(
      `SELECT COALESCE(SUM(amount - consumed), 0) AS p FROM rakeback_pendiente WHERE agent_id = $1 AND active = true AND ABS(amount - consumed) > 0.004`,
      [agentId]
    )
  ).rows[0];
  if (Math.abs(Number(rb.p)) >= 0.01) saldos.push({ donde: "Rakeback pendiente", monto: r2(Number(rb.p)) });

  const conPlata = saldos.filter((s) => Math.abs(s.monto) >= 0.01);
  return { agentId, name: ag.name, saldos, bloqueos, puede: bloqueos.length === 0 && conPlata.length === 0 };
}

export async function darDeBajaAgente(agentId: string) {
  await asegurarColumnas();
  const ch = await chequeoBajaAgente(agentId);
  if (!ch) return null;
  if (!ch.puede) {
    const plata = ch.saldos.filter((s) => Math.abs(s.monto) >= 0.01).map((s) => `${s.donde}: US$ ${s.monto.toFixed(2)}`);
    throw new Error(["No se puede dar de baja.", ...ch.bloqueos, ...(plata.length ? [`Todavía tiene saldo (${plata.join(" · ")}). Saldalo primero.`] : [])].join(" "));
  }
  const r = await pool.query(`UPDATE agents SET active = false, baja_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [agentId]);
  // Sin acceso al portal (los admins nunca se tocan). Se marca cuáles apagó la baja para volver a prenderlos al reactivar.
  await pool.query(
    // Solo los usuarios de agente: un usuario SUPERVISOR atado a este agente (caso "Blas" atado a Cachito1976, 19/11/2026) no se corta.
    `UPDATE agent_users SET active = false, desactivado_por_baja = true WHERE agent_id = $1 AND active = true AND role = 'AGENT'`,
    [agentId]
  );
  return r.rows[0];
}

export async function reactivarAgente(agentId: string) {
  await asegurarColumnas();
  const r = await pool.query(`UPDATE agents SET active = true, baja_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`, [agentId]);
  if (r.rows[0]) {
    await pool.query(`UPDATE agent_users SET active = true, desactivado_por_baja = false WHERE agent_id = $1 AND desactivado_por_baja = true`, [agentId]);
  }
  return r.rows[0] ?? null;
}
