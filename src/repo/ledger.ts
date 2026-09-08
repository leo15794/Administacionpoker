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
 * Revierte un movimiento cargado por error. LEDGER INMUTABLE: nunca se borra ni se pisa el
 * movimiento original — queda marcado status=REVERTIDO para siempre, y se genera un
 * movimiento AJUSTE nuevo con el efecto exactamente opuesto (mismo mecanismo con el que se
 * reconstruye cualquier historial: original + reversa, nunca una edición silenciosa).
 *
 * Qué hace, todo en una transacción (todo o nada):
 *  1) Aplica a los balances el delta opuesto al que aplicó el movimiento original (origen y,
 *     si era transferencia, destino).
 *  2) Si el original tenía tesorería asociada (USDT/EFECTIVO/ZELLE), crea una NUEVA
 *     treasury_entry con la dirección invertida para el mismo ledger y custodio — nunca borra
 *     la original, así el historial de Wallet/Caja también queda completo.
 *  3) Inserta el movimiento de reversa en ledger_movements (type=AJUSTE, refs=[originalId]),
 *     con su propia idempotency_key para que revertir dos veces el mismo movimiento no
 *     duplique el efecto.
 *  4) Marca el original status=REVERTIDO (UPDATE, no DELETE).
 *  5) Si el original era un CIERRE_SEMANAL, también marca REVERTIDO su fila en
 *     weekly_closings (nunca se borra esa fila tampoco).
 */
export async function revertirMovimiento(id: string, motivo?: string, revertidoPor?: string | null) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(`SELECT * FROM ledger_movements WHERE id = $1 FOR UPDATE`, [id]);
    const mov = r.rows[0];
    if (!mov) {
      await client.query("ROLLBACK");
      return { found: false };
    }
    if (mov.status === "REVERTIDO") {
      await client.query("ROLLBACK");
      throw new Error("Este movimiento ya fue revertido antes — no se puede revertir dos veces.");
    }

    const deltaOrigen = deltaParaBalance(mov.type, Number(mov.amount), false);
    await upsertBalanceDelta(client, mov.agent_id, mov.club_id, -deltaOrigen);
    let deltaDestino: number | null = null;
    if (mov.type === "TRANSFERENCIA_ENTRE_CLUBES" && mov.club_destino_id) {
      deltaDestino = deltaParaBalance(mov.type, Number(mov.amount), true);
      await upsertBalanceDelta(client, mov.agent_id, mov.club_destino_id, -deltaDestino);
    }

    const idReversa = newId("mov");
    const idempotencyKeyReversa = `revert_${id}`;
    const observacionReversa = `Reversión de movimiento ${id} (${mov.type})${motivo ? `: ${motivo}` : "."} El original queda en el historial marcado como revertido, nunca se borra.`;

    await client.query(
      `INSERT INTO ledger_movements
        (id, idempotency_key, type, club_id, club_destino_id, agent_id, amount,
         payment_method, status, occurred_at, observation, refs, created_by)
       VALUES ($1,$2,'AJUSTE',$3,$4,$5,$6,$7,'APLICADO',now(),$8,$9,$10)`,
      [
        idReversa,
        idempotencyKeyReversa,
        mov.club_id,
        mov.club_destino_id,
        mov.agent_id,
        -deltaOrigen,
        mov.payment_method,
        observacionReversa,
        [id],
        revertidoPor ?? null,
      ]
    );

    // Si el original tenía tesorería asociada, la reversa también genera su propia entrada
    // (dirección invertida) — nunca se toca ni se borra la entrada original.
    const treOriginal = await client.query(`SELECT * FROM treasury_entries WHERE movement_id = $1`, [id]);
    if (treOriginal.rows.length > 0) {
      const tre = treOriginal.rows[0];
      await client.query(
        `INSERT INTO treasury_entries (id, movement_id, ledger, direction, amount, custodian, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [newId("tre"), idReversa, tre.ledger, tre.direction === "INGRESO" ? "EGRESO" : "INGRESO", tre.amount, tre.custodian]
      );
    }

    await client.query(`UPDATE ledger_movements SET status = 'REVERTIDO' WHERE id = $1`, [id]);

    // Un CIERRE_SEMANAL siempre viene acompañado de su fila en weekly_closings (se insertan
    // juntos en aplicarCierreSemanal) — se marca REVERTIDO ahí también, nunca se borra, para
    // que quede visible en el historial de Cierres semanales que existió y fue anulado.
    if (mov.type === "CIERRE_SEMANAL") {
      await client.query(
        `UPDATE weekly_closings SET status = 'REVERTIDO'
         WHERE agent_id = $1 AND club_id = $2 AND week_end = $3::date`,
        [mov.agent_id, mov.club_id, mov.occurred_at]
      );
    }

    await client.query("COMMIT");
    return { found: true, id, idReversa };
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
