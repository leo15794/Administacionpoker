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
  /** Salta la "nota de crédito" (carga_pendientes_cruce) que una CARGA abre normalmente para
   * cruzar después en Liquidaciones -- uso exclusivo de pagarPendiente() (repo/rakebackPendiente.ts)
   * cuando la CARGA es el pago en fichas de un rakeback pendiente que YA está resuelto (queda
   * marcado `consumed` ahí mismo): no tiene sentido abrir una nota de crédito nueva para algo
   * que no es un adelanto sino la liquidación misma (Leo, 22/09/2026: "no debería quedar
   * pendiente de pago porque ya se le acreditaron"). Nunca se usa para una CARGA común. */
  sinNotaDeCredito?: boolean;
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

    // Un movimiento REVERTIDO no cuenta como "ya aplicado" (mismo principio que weekly_closings
    // — ver schema.sql, índice único parcial): si se revirtió, la misma idempotency_key tiene
    // que poder generarse de nuevo para volver a aplicar esa operación correctamente.
    const existing = await client.query(
      `SELECT id FROM ledger_movements WHERE idempotency_key = $1 AND status <> 'REVERTIDO'`,
      [input.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return { id: existing.rows[0].id, alreadyApplied: true };
    }

    const movementId = newId("mov");
    const paymentMethod = input.paymentMethod ?? "SIN_TESORERIA";

    // DESCARGA (el agente entrega fichas/crédito) se guarda con signo negativo -- Leo,
    // 22/09/2026: "la descarga de fichas tienen que ser negativas". Antes se guardaba el
    // monto tal cual lo tipeaba quien carga el movimiento (siempre positivo), lo que hacía
    // que el historial y el CSV mostraran una descarga en verde/positivo aunque reduce el
    // saldo del agente (ver deltaParaBalance más abajo, que ya la resta -- esto solo alinea
    // el monto GUARDADO con esa misma convención documentada: "positivo = a favor del
    // agente, negativo = a favor nuestro"). No afecta el balance: deltaParaBalance siempre
    // normaliza con Math.abs() antes de aplicar el signo según el tipo.
    const storedAmount = input.type === "DESCARGA" ? -Math.abs(input.amount) : input.amount;

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
        storedAmount,
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

    // Carga de tesorería (21/09/2026, pedido de Leo): un movimiento CARGA además de sumar al
    // balance del agente (arriba) abre una "nota de crédito" pendiente de cruzar contra ese
    // agente+club — mismo mecanismo que un adelanto de rakeback (amount/consumed), para poder
    // descontarla después en Liquidaciones (ver repo/cargaCruces.ts). Independiente del método
    // de pago (a diferencia de treasury_entries, que solo se genera con USDT/EFECTIVO/ZELLE).
    if (input.type === "CARGA" && !input.sinNotaDeCredito) {
      const cargaId = newId("cpc");
      const montoCarga = Math.abs(input.amount);
      await client.query(
        `INSERT INTO carga_pendientes_cruce (id, movement_id, agent_id, club_id, amount, consumed, active)
         VALUES ($1,$2,$3,$4,$5,0,true)`,
        [cargaId, movementId, input.agentId, input.clubId, montoCarga]
      );
      await client.query(
        `INSERT INTO carga_cruce_movements (id, carga_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
         VALUES ($1,$2,$3,'ALTA',$4,$4,0,$5,$6)`,
        [newId("ccm"), cargaId, input.agentId, montoCarga, input.observation ?? null, input.createdBy ?? null]
      );
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
    case "PAGO_RAKEBACK":
      // Pago financiero (USDT/efectivo/Zelle) de un rakeback pendiente -- nunca toca el
      // stock/balance del agente (eso es lo que registra rakeback_pendiente aparte). A
      // propósito NO es lo mismo que "PAGO", que siempre resta del balance -- ver
      // repo/rakebackPendiente.ts.
      return 0;
    case "ADELANTO_RAKEBACK":
      // Adelanto de rakeback dado en USDT (repo/advances.ts): sale de la wallet (entrada de
      // tesorería EGRESO, ver más abajo) pero NO es plata que el agente ya ganó operativamente
      // -- eso lo trackea rakeback_advances aparte (amount/consumed), igual que con
      // PAGO_RAKEBACK. Un adelanto en FICHAS, en cambio, SÍ usa el tipo CARGA normal (mueve el
      // stock de verdad, porque son fichas físicas que se le dieron).
      return 0;
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
    // system (24/09/2026, pedido de Leo: "faltaria hacerlo para los agentes" -- separar
    // Win/Lose de Prepago también en "Saldos por agente y club"): mismo criterio de siempre
    // (deal vigente agente↔club si existe, si no default_system del agente), resuelto en vivo
    // porque un balance es la foto ACTUAL, no un snapshot -- no tiene su propio "system" guardado.
    // ultimo_cierre_* (24/09/2026, pedido de Leo: "en saldos por agente y club" -- que a cada
    // agente WIN_LOSE se le vea el cierre final de SU ÚLTIMA semana cerrada, aparte del saldo
    // acumulado de la cuenta corriente, que ya sube/baja solo con los cierres y los
    // pagos/cobros/retiros posteriores -- ver DELTA_SQL en repo/agentesResumen.ts, mismo
    // principio). Es puramente informativo: no participa en ningún cálculo, solo se muestra.
    `SELECT b.*, a.name as agent_name, c.name as club_name,
            COALESCE(
              (SELECT d.system FROM agent_club_deals d
               WHERE d.agent_id = b.agent_id AND d.club_id = b.club_id AND d.valid_to IS NULL
               ORDER BY d.valid_from DESC LIMIT 1),
              a.default_system
            ) as system,
            ultimo_cierre.final_closing as ultimo_cierre_monto,
            ultimo_cierre.week_start as ultimo_cierre_week_start,
            ultimo_cierre.week_end as ultimo_cierre_week_end,
            COALESCE(cargas_descargas.total_cargado, 0) as total_cargado,
            COALESCE(cargas_descargas.total_descargado, 0) as total_descargado,
            COALESCE(mesas.total_fichas_ganadas_mesas, 0) as total_fichas_ganadas_mesas
     FROM balances b
     JOIN agents a ON a.id = b.agent_id
     JOIN clubs c ON c.id = b.club_id
     LEFT JOIN LATERAL (
       SELECT wc.final_closing, wc.week_start, wc.week_end
       FROM weekly_closings wc
       WHERE wc.agent_id = b.agent_id AND wc.club_id = b.club_id AND wc.status <> 'REVERTIDO'
       ORDER BY wc.week_end DESC LIMIT 1
     ) ultimo_cierre ON true
     -- Cargado/Descargado (24/09/2026, pedido de Leo: 3 columnas para PREPAGO -- cargas,
     -- descargas y el saldo, que tiene que dar la resta de las dos). Para un agente PREPAGO,
     -- CARGA y DESCARGA son los ÚNICOS tipos que mueven el balance (ver repo/closings.ts y
     -- repo/rakebackPendiente.ts) -- por eso total_cargado - total_descargado siempre coincide
     -- con balances.amount para ellos. Se calcula igual para todos (no solo PREPAGO) porque es
     -- más simple y no afecta nada -- el frontend decide para qué sistema mostrar las columnas.
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(SUM(ABS(m.amount)) FILTER (WHERE m.type = 'CARGA'), 0) as total_cargado,
         COALESCE(SUM(ABS(m.amount)) FILTER (WHERE m.type = 'DESCARGA'), 0) as total_descargado
       FROM ledger_movements m
       WHERE m.agent_id = b.agent_id AND m.club_id = b.club_id AND m.status <> 'REVERTIDO'
         AND m.type IN ('CARGA', 'DESCARGA')
     ) cargas_descargas ON true
     -- Fichas ganadas en mesas (24/09/2026, pedido de Leo: nueva columna para PREPAGO, "Cargado
     -- - Descargado + Fichas ganadas en las mesas = Fichas") -- el resultado crudo de mesas
     -- (wc.result) de todos los cierres PREPAGO de este agente+club, sumado histórico. Es
     -- puramente informativo/de referencia -- el campo "Fichas" real sigue siendo
     -- balances.amount, que en la UI ahora se puede editar a mano (ver POST /movements tipo
     -- AJUSTE) solo para PREPAGO.
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(wc.result), 0) as total_fichas_ganadas_mesas
       FROM weekly_closings wc
       WHERE wc.agent_id = b.agent_id AND wc.club_id = b.club_id AND wc.status <> 'REVERTIDO'
         AND wc.system = 'PREPAGO'
     ) mesas ON true
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

/**
 * Borrado real de un movimiento cargado por error (ej. de prueba) -- a diferencia de
 * revertirMovimiento (LEDGER INMUTABLE: nunca borra, genera una reversa y marca el original
 * como REVERTIDO), esto lo saca del todo: deshace su efecto en los balances, borra su
 * treasury_entry si tenía, y borra la fila. Pensado SOLO para limpiar cargas de prueba o mal
 * tipeadas -- para corregir un movimiento de negocio real ya asentado usar "Revertir".
 *
 * Limitado al ÚLTIMO movimiento (no revertido) de ese agente+club, mismo criterio que
 * eliminarMovimientoAdelanto en repo/advances.ts: borrar uno del medio dejaría el balance
 * corriente calculado sobre un orden de movimientos que ya no es el real.
 */
export async function eliminarMovimiento(movementId: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const r = await client.query(`SELECT * FROM ledger_movements WHERE id = $1 FOR UPDATE`, [movementId]);
    const mov = r.rows[0];
    if (!mov) throw new Error("No se encontró ese movimiento.");
    if (mov.status === "REVERTIDO") {
      throw new Error("Este movimiento ya está revertido -- no hace falta (ni se puede) borrarlo también.");
    }
    if (mov.type === "CIERRE_SEMANAL") {
      throw new Error("Un cierre semanal no se borra desde acá -- usá la opción de revertir cierre en Cierres.");
    }
    if (mov.refs && mov.refs.length > 0) {
      throw new Error("Este movimiento es la reversa de otro (generado por \"Revertir\") -- borrarlo dejaría el original mal marcado. No se puede eliminar.");
    }

    const ultimoOrigen = await client.query(
      `SELECT id FROM ledger_movements WHERE agent_id = $1 AND club_id = $2 AND status <> 'REVERTIDO'
       ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [mov.agent_id, mov.club_id]
    );
    if (ultimoOrigen.rows[0]?.id !== movementId) {
      throw new Error("Solo se puede borrar el movimiento MÁS RECIENTE de este agente+club -- borralos en orden, del más nuevo hacia atrás.");
    }
    if (mov.type === "TRANSFERENCIA_ENTRE_CLUBES" && mov.club_destino_id) {
      const ultimoDestino = await client.query(
        `SELECT id FROM ledger_movements WHERE agent_id = $1 AND club_id = $2 AND status <> 'REVERTIDO'
         ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [mov.agent_id, mov.club_destino_id]
      );
      if (ultimoDestino.rows[0]?.id !== movementId) {
        throw new Error("Solo se puede borrar el movimiento MÁS RECIENTE también en el club destino de la transferencia.");
      }
    }

    // Si es una CARGA que ya se cruzó (parcial o totalmente) en una liquidación, bloquear --
    // borrarla dejaría esa liquidación con plata "fantasma" ya descontada de un pago real.
    if (mov.type === "CARGA") {
      const cargaRes = await client.query(`SELECT * FROM carga_pendientes_cruce WHERE movement_id = $1`, [movementId]);
      const carga = cargaRes.rows[0];
      if (carga && Number(carga.consumed) > 0) {
        throw new Error("Esta carga ya se cruzó (parcial o totalmente) en una liquidación guardada -- corregí esa liquidación antes de borrar el movimiento.");
      }
      if (carga) {
        await client.query(`DELETE FROM carga_cruce_movements WHERE carga_id = $1`, [carga.id]);
        await client.query(`DELETE FROM carga_pendientes_cruce WHERE id = $1`, [carga.id]);
      }
    }

    const deltaOrigen = deltaParaBalance(mov.type, Number(mov.amount), false);
    await upsertBalanceDelta(client, mov.agent_id, mov.club_id, -deltaOrigen);
    if (mov.type === "TRANSFERENCIA_ENTRE_CLUBES" && mov.club_destino_id) {
      const deltaDestino = deltaParaBalance(mov.type, Number(mov.amount), true);
      await upsertBalanceDelta(client, mov.agent_id, mov.club_destino_id, -deltaDestino);
    }

    await client.query(`DELETE FROM treasury_entries WHERE movement_id = $1`, [movementId]);
    // rakeback_advance_movements (Adelantos) y rakeback_pendiente_movements (Rakeback
    // pendiente) también pueden apuntar a este movimiento con su propio movement_id (22/09/2026,
    // bug real: "update or delete on table ledger_movements violates foreign key constraint
    // rakeback_advance_movements_movement_id_fkey" -- faltaba limpiar esta referencia antes del
    // DELETE, mismo criterio que ya se usa arriba para treasury_entries/carga_pendientes_cruce).
    // Se pone en NULL en vez de borrar la fila: el historial del adelanto/pendiente lo maneja
    // su propio repo (advances.ts / rakebackPendiente.ts), acá solo se libera la referencia
    // para que el ledger_movement se pueda borrar.
    await client.query(`UPDATE rakeback_advance_movements SET movement_id = NULL WHERE movement_id = $1`, [movementId]);
    await client.query(`UPDATE rakeback_pendiente_movements SET movement_id = NULL WHERE movement_id = $1`, [movementId]);
    await client.query(`DELETE FROM ledger_movements WHERE id = $1`, [movementId]);

    await client.query("COMMIT");
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
