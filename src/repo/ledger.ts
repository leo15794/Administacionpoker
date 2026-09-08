import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";

export interface NewMovement {
  idempotencyKey: string;
  type: string;
  clubId: string;
  clubDestinoId?: string | null;
  agentId: string;
  amount: number;
  originalAmount?: number | null;
  originalUnit?: string | null;
  paymentMethod?: string; // USDT | EFECTIVO | ZELLE | SIN_TESORERIA | OTRO
  occurredAt: Date;
  observation?: string | null;
  refs?: string[];
  createdBy?: string | null;
  custodian?: string | null; // requerido si paymentMethod = EFECTIVO
}

/**
 * Registra un movimiento de forma ATÓMICA e IDEMPOTENTE:
 *  1) inserta en ledger_movements (la clave única idempotency_key rechaza duplicados)
 *  2) si corresponde, crea su proyección de tesorería (treasury_entries)
 *  3) actualiza balances (agente, club origen y, si es transferencia, club destino)
 * Todo dentro de una misma transacción de Postgres: o se aplica completo, o no se aplica nada
 * (esto es exactamente lo que pide BIT-012/018/029/048/049/056: "no marcar SINCRONIZADO
 * hasta validar todos los destinos").
 *
 * Si ya existe un movimiento con esa idempotency_key, la función es un no-op seguro:
 * devuelve el movimiento existente sin tocar nada (evita el patrón de bug más repetido
 * en la bitácora: aplicar el mismo movimiento dos veces).
 */
export async function registrarMovimiento(input: NewMovement) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM ledger_movements WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { id: existing.rows[0].id, alreadyApplied: true };
    }

    const movementId = newId("mov");
    const paymentMethod = input.paymentMethod ?? "SIN_TESORERIA";

    await client.query(
      `INSERT INTO ledger_movements
        (id, idempotency_key, type, club_id, club_destino_id, agent_id, amount,
         original_amount, original_unit, payment_method, status, occurred_at,
         observation, refs, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'APLICADO',$11,$12,$13,$14)`,
      [
        movementId,
        input.idempotencyKey,
        input.type,
        input.clubId,
        input.clubDestinoId ?? null,
        input.agentId,
        input.amount,
        input.originalAmount ?? null,
        input.originalUnit ?? null,
        paymentMethod,
        input.occurredAt,
        input.observation ?? null,
        input.refs ?? [],
        input.createdBy ?? null,
      ]
    );

    // Tesorería: el medio de pago define el ledger (regla BIT-051/052).
    // SIN_TESORERIA (ej. transferencias internas de fichas) no genera entrada de caja.
    if (paymentMethod === "USDT" || paymentMethod === "EFECTIVO" || paymentMethod === "ZELLE") {
      const ledger = paymentMethod === "EFECTIVO" ? "CAJA_EFECTIVO" : "WALLET_MANOS";
      if (paymentMethod === "EFECTIVO" && !input.custodian) {
        throw new Error("Un movimiento en EFECTIVO requiere custodio físico (regla BIT-051/052).");
      }
      const direction = ["COBRO", "CARGA"].includes(input.type) ? "INGRESO" : "EGRESO";
      await client.query(
        `INSERT INTO treasury_entries (id, movement_id, ledger, direction, amount, custodian, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId("tre"), movementId, ledger, direction, Math.abs(input.amount), input.custodian ?? null, input.occurredAt]
      );
    }

    // Proyección de balance: club origen siempre se actualiza.
    await upsertBalanceDelta(client, input.agentId, input.clubId, deltaParaBalance(input.type, input.amount, false));

    // Si es transferencia entre clubes, actualiza también el club destino (mismo signo invertido).
    if (input.type === "TRANSFERENCIA_ENTRE_CLUBES") {
      if (!input.clubDestinoId) throw new Error("TRANSFERENCIA_ENTRE_CLUBES requiere clubDestinoId.");
      await upsertBalanceDelta(client, input.agentId, input.clubDestinoId, deltaParaBalance(input.type, input.amount, true));
    }

    await client.query("COMMIT");
    return { id: movementId, alreadyApplied: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Convención de signo (documentada en la planilla): positivo = a favor del agente,
// negativo = a favor nuestro. CARGA/COBRO aumentan lo que tiene el agente a favor
// (ficha o crédito propio); DESCARGA/PAGO lo reducen. Transferencia: sale de un club,
// entra al otro, neto cero.
function deltaParaBalance(type: string, amount: number, esDestinoDeTransferencia: boolean): number {
  switch (type) {
    case "CARGA":
      return Math.abs(amount);
    case "DESCARGA":
      return -Math.abs(amount);
    case "COBRO":
      // un cobro que recibimos reduce lo que el agente tiene a favor (le estamos "cobrando" saldo)
      return -Math.abs(amount);
    case "PAGO":
      // un pago que enviamos reduce nuestra deuda = reduce el saldo a favor del agente
      return -Math.abs(amount);
    case "TICKET_PROMOCIONAL":
    case "AJUSTE":
    case "CIERRE_SEMANAL":
      return amount; // el signo ya viene resuelto por el motor de cierre / el caso de uso
    case "TRANSFERENCIA_ENTRE_CLUBES":
      return esDestinoDeTransferencia ? Math.abs(amount) : -Math.abs(amount);
    default:
      return amount;
  }
}

async function upsertBalanceDelta(client: PoolClient, agentId: string, clubId: string, delta: number) {
  await client.query(
    `INSERT INTO balances (id, agent_id, club_id, amount, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (agent_id, club_id)
     DO UPDATE SET amount = balances.amount + EXCLUDED.amount, updated_at = now()`,
    [newId("bal"), agentId, clubId, delta]
  );
}

export async function getBalance(agentId: string, clubId: string) {
  const r = await pool.query(`SELECT * FROM balances WHERE agent_id=$1 AND club_id=$2`, [agentId, clubId]);
  return r.rows[0] ?? null;
}

export async function listBalancesByAgent(agentId: string) {
  const r = await pool.query(
    `SELECT b.*, c.name as club_name FROM balances b JOIN clubs c ON c.id = b.club_id WHERE agent_id=$1 ORDER BY c.name`,
    [agentId]
  );
  return r.rows;
}

export async function listAllBalances() {
  const r = await pool.query(
    `SELECT b.*, a.name as agent_name, c.name as club_name
     FROM balances b JOIN agents a ON a.id = b.agent_id JOIN clubs c ON c.id = b.club_id
     ORDER BY a.name, c.name`
  );
  return r.rows;
}

/**
 * Elimina un movimiento y revierte TODO lo que generó (BIT-style: nunca dejar rastros
 * huérfanos). Reversa el/los delta(s) de balance (origen y, si es transferencia, destino),
 * borra su treasury_entry si existía, y borra el movimiento. Todo en una transacción: o se
 * revierte completo, o no se toca nada. Pensado como acción exclusiva de administrador para
 * corregir un movimiento cargado por error (histórico importado o cargado a mano).
 */
export async function eliminarMovimiento(id: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(`SELECT * FROM ledger_movements WHERE id = $1 FOR UPDATE`, [id]);
    const mov = r.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return { found: false };
    }

    // Revertir el delta de balance con el signo opuesto al que se aplicó al registrarlo.
    await upsertBalanceDelta(client, mov.agent_id, mov.club_id, -deltaParaBalance(mov.type, Number(mov.amount), false));
    if (mov.type === "TRANSFERENCIA_ENTRE_CLUBES" && mov.club_destino_id) {
      await upsertBalanceDelta(client, mov.agent_id, mov.club_destino_id, -deltaParaBalance(mov.type, Number(mov.amount), true));
    }

    await client.query(`DELETE FROM treasury_entries WHERE movement_id = $1`, [id]);
    await client.query(`DELETE FROM ledger_movements WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return { found: true, id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMovementsByAgent(agentId: string, limit = 200) {
  const r = await pool.query(
    `SELECT m.*, c.name as club_name FROM ledger_movements m JOIN clubs c ON c.id = m.club_id
     WHERE m.agent_id=$1 ORDER BY m.occurred_at DESC LIMIT $2`,
    [agentId, limit]
  );
  return r.rows;
}
