import { pool, newId } from "../db/pool.js";
import { registrarAjusteTesoreria } from "./treasury.js";

// Vista "todo junto" de comisiones por referido para la pantalla dedicada (Comisiones por
// referido, en el menú) — agrupa por supervisor (login) en vez de por agente referido, porque
// lo que se paga es "todo lo que le corresponde a este supervisor", no fila por fila.
export async function listarComisionesReferidos() {
  const r = await pool.query(
    `SELECT r.id as referido_id, r.porcentaje, r.saldo,
            a.id as agente_id, a.name as agente_name,
            u.id as user_id, u.email
     FROM supervisor_referidos r
     JOIN agents a ON a.id = r.agente_referido_id
     JOIN agent_users u ON u.id = r.supervisor_user_id
     WHERE r.active = true
     ORDER BY u.email, a.name`
  );

  const porSupervisor = new Map<string, { userId: string; email: string; saldoTotal: number; referidos: any[] }>();
  for (const row of r.rows) {
    if (!porSupervisor.has(row.user_id)) {
      porSupervisor.set(row.user_id, { userId: row.user_id, email: row.email, saldoTotal: 0, referidos: [] });
    }
    const grupo = porSupervisor.get(row.user_id)!;
    grupo.saldoTotal += Number(row.saldo);
    grupo.referidos.push({
      id: row.referido_id,
      agenteId: row.agente_id,
      agenteName: row.agente_name,
      porcentaje: row.porcentaje,
      saldo: row.saldo,
    });
  }
  return Array.from(porSupervisor.values());
}

// Botón "Pagar" de la pantalla de Comisiones por referido: cruza TODO el saldo acumulado de
// TODOs los agentes referidos de un mismo supervisor contra un solo egreso en Wallet (mismo
// patrón que ya usa "Registrar el pago" en Jugadores bancados), y deja cada fila en 0 con su
// propio movimiento tipo PAGO en el historial — así el historial de cada agente referido
// muestra exactamente cuándo se cobró, aunque el pago en Wallet haya sido uno solo por el total.
export async function pagarComisionesReferido(userId: string, createdBy?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const referidos = await client.query(
      `SELECT r.id, r.saldo, u.email
       FROM supervisor_referidos r
       JOIN agent_users u ON u.id = r.supervisor_user_id
       WHERE r.supervisor_user_id = $1 AND r.active = true
       FOR UPDATE`,
      [userId]
    );
    if (referidos.rows.length === 0) {
      throw new Error("Este supervisor no tiene comisiones por referido activas.");
    }
    const total = referidos.rows.reduce((acc: number, row: any) => acc + Number(row.saldo), 0);
    if (total <= 0) {
      throw new Error("No hay saldo positivo para pagar — revisá el historial si esperabas otra cosa.");
    }
    const email = referidos.rows[0].email;

    const { id: movementId } = await registrarAjusteTesoreria({
      ledger: "WALLET_MANOS",
      direction: "EGRESO",
      amount: total,
      reason: `Pago comisión por referido — ${email}`,
      createdBy: createdBy ?? null,
    });

    for (const row of referidos.rows) {
      const saldoAnterior = Number(row.saldo);
      if (saldoAnterior === 0) continue;
      await client.query(`UPDATE supervisor_referidos SET saldo = 0, updated_at = now() WHERE id = $1`, [row.id]);
      await client.query(
        `INSERT INTO supervisor_referido_movements (id, referido_id, weekly_closing_id, type, amount, resulting_saldo, notes)
         VALUES ($1,$2,NULL,'PAGO',$3,0,$4)`,
        [newId("srm"), row.id, -saldoAnterior, `Pago cruzado contra Wallet (ajuste ${movementId})`]
      );
    }

    await client.query("COMMIT");
    return { walletMovementId: movementId, total };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
