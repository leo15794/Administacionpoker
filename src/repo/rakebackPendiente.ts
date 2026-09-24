import { pool, newId } from "../db/pool.js";
import { registrarMovimiento } from "./ledger.js";

// Rakeback pendiente (22/09/2026, pedido de Leo): al aplicar un cierre semanal, el stock
// físico del agente solo se mueve por el resultado de mesas (Win/Lose) -- ver repo/closings.ts.
// Todo lo demás (rakeback, rebate, Rodeo, ajuste manual) queda ACÁ, pendiente de decidir cómo
// se salda: pagarlo en fichas (mueve stock, movimiento CARGA), pagarlo en USDT/efectivo/Zelle
// (pago financiero real, movimiento PAGO, nunca toca stock) o dejarlo pendiente sin más.

export async function listRakebackPendiente() {
  const r = await pool.query(
    `SELECT rp.*, a.name as agent_name, c.name as club_name, wc.week_start, wc.week_end
     FROM rakeback_pendiente rp
     JOIN agents a ON a.id = rp.agent_id
     JOIN clubs c ON c.id = rp.club_id
     JOIN weekly_closings wc ON wc.id = rp.weekly_closing_id
     WHERE rp.active = true AND rp.amount > rp.consumed
     ORDER BY wc.week_end DESC, a.name`
  );
  return r.rows;
}

export interface PagarPendienteInput {
  pendienteId: string;
  amount: number;
  medio: "FICHAS" | "USDT" | "EFECTIVO" | "ZELLE";
  custodian?: string;
  notes?: string;
  createdBy?: string;
}

/**
 * Paga (total o parcialmente) un rakeback pendiente. "FICHAS" genera un movimiento CARGA real
 * (SÍ mueve el stock físico del agente); "USDT"/"EFECTIVO"/"ZELLE" generan un PAGO real contra
 * la wallet/caja (NO toca el stock). No corre dentro de la misma transacción que
 * registrarMovimiento (que administra la suya propia) -- mismo criterio ya aceptado en el resto
 * de la app para este tipo de cruces (ver aplicarCrucesCarga en Liquidaciones.tsx).
 */
export async function pagarPendiente(input: PagarPendienteInput) {
  if (!(input.amount > 0)) throw new Error("El monto tiene que ser mayor a 0.");

  const existing = await pool.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true`, [input.pendienteId]);
  const actual = existing.rows[0];
  if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");

  const pendienteDisponible = Number(actual.amount) - Number(actual.consumed);
  if (input.amount > pendienteDisponible + 0.005) {
    throw new Error("El pago no puede superar el monto pendiente disponible.");
  }
  if (input.medio === "EFECTIVO" && !input.custodian) {
    throw new Error("Un pago en efectivo requiere custodio físico (regla BIT-051/052).");
  }

  // PREPAGO (24/09/2026, pedido de Leo): un agente PREPAGO solo tiene fichas por lo que paga
  // por adelantado -- si le pagamos su rakeback pendiente en plata real (USDT/EFECTIVO/ZELLE),
  // eso tiene que RESTARLE fichas (puede quedar en negativo -- "puede quedar negativo porque
  // como le damos adelanto nos puede deber", cita textual de Leo). Para AGENTE de sistema
  // WIN_LOSE y para SUPERVISOR (rebate centralizado) sigue como siempre: pagar en USDT/EFECTIVO/
  // ZELLE NO toca el balance -- ver el bug de 22/09/2026 más abajo, que sigue vigente para esos
  // dos casos.
  let systemDelPendiente: string | null = null;
  if (actual.role === "AGENTE" && actual.weekly_closing_id) {
    const wcRes = await pool.query(`SELECT system FROM weekly_closings WHERE id = $1`, [actual.weekly_closing_id]);
    systemDelPendiente = wcRes.rows[0]?.system ?? null;
  }
  // (24/09/2026, encontrado por un caso real en Liquidaciones -- tb prodigio25 y yAtt0r0
  // quedaron con fichas de más porque el formulario tildaba "FICHAS" por defecto sin distinguir
  // el sistema) esto se bloqueó del todo para PREPAGO -- el mismo día, más tarde, Leo pidió
  // volver a habilitarlo a propósito: pagar el rakeback pendiente de un PREPAGO en fichas es una
  // forma válida de adelanto (igual que un Adelanto de rakeback en fichas), el problema nunca
  // fue la opción en sí, era que apareciera TILDADA POR DEFECTO sin que nadie la eligiera a
  // propósito -- eso ya se corrigió del lado del frontend (Liquidaciones ya no ofrece/tilda
  // "FICHAS" por defecto para PREPAGO, ver abrirMov() en web/src/pages/Liquidaciones.tsx), así
  // que acá ya no hace falta bloquearlo también del lado del servidor.
  const restaFichasPrepago = input.medio !== "FICHAS" && actual.role === "AGENTE" && systemDelPendiente === "PREPAGO";

  const reg = await registrarMovimiento({
    idempotencyKey: `pago_rakeback:${input.pendienteId}:${newId("x")}`,
    // FICHAS = CARGA real (mueve el stock físico). USDT/EFECTIVO/ZELLE = "PAGO_RAKEBACK", un
    // tipo propio que SÍ genera su entrada de tesorería pero NUNCA toca el balance/stock del
    // agente (a diferencia de "PAGO", que siempre resta del balance -- ver deltaParaBalance en
    // repo/ledger.ts). Bug encontrado el 22/09/2026 en el test end-to-end: con "PAGO" común,
    // pagar rakeback en USDT restaba del balance de fichas, mezclando de nuevo lo que este
    // cambio entero busca separar. Esto sigue así para WIN_LOSE/SUPERVISOR -- para AGENTE
    // PREPAGO, el ajuste de balance se hace aparte más abajo (restaFichasPrepago), con un
    // movimiento DESCARGA propio en vez de mezclarlo acá.
    type: input.medio === "FICHAS" ? "CARGA" : "PAGO_RAKEBACK",
    clubId: actual.club_id,
    agentId: actual.agent_id,
    amount: input.amount,
    paymentMethod: input.medio === "FICHAS" ? "SIN_TESORERIA" : input.medio,
    custodian: input.medio === "EFECTIVO" ? input.custodian : undefined,
    occurredAt: new Date(),
    observation:
      input.notes ||
      (input.medio === "FICHAS"
        ? "Pago de rakeback pendiente en fichas."
        : `Pago de rakeback pendiente en ${input.medio}.`),
    createdBy: input.createdBy ?? null,
    // Esto YA queda resuelto acá abajo (rakeback_pendiente.consumed) -- no tiene que abrir
    // además una nota de crédito de "carga pendiente de cruce" para volver a aparecer como
    // pendiente en Liquidaciones (Leo, 22/09/2026).
    sinNotaDeCredito: input.medio === "FICHAS",
  });

  if (restaFichasPrepago) {
    await registrarMovimiento({
      idempotencyKey: `pago_rakeback_descarga:${input.pendienteId}:${newId("x")}`,
      // DESCARGA de fichas por el mismo monto -- sin esto, un agente PREPAGO quedaría con el
      // rakeback pendiente pagado en plata real pero sin que le baje nada de su saldo de
      // fichas (que para PREPAGO tiene que reflejar solo lo real: cargas, adelantos y ahora
      // este descuento). SIN_TESORERIA porque la entrada de caja/wallet ya la generó el
      // movimiento PAGO_RAKEBACK de arriba -- esto es puramente el ajuste de stock.
      type: "DESCARGA",
      clubId: actual.club_id,
      agentId: actual.agent_id,
      amount: input.amount,
      paymentMethod: "SIN_TESORERIA",
      occurredAt: new Date(),
      observation: `Descuento de fichas por pago de rakeback pendiente en ${input.medio} (agente PREPAGO).`,
      createdBy: input.createdBy ?? null,
      sinNotaDeCredito: true,
    });
  }

  const nuevoConsumed = Number(actual.consumed) + input.amount;
  const r = await pool.query(
    `UPDATE rakeback_pendiente SET consumed = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [nuevoConsumed, actual.id]
  );
  const pendiente = r.rows[0];
  await pool.query(
    `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, movement_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newId("rpm"),
      pendiente.id,
      pendiente.agent_id,
      input.medio === "FICHAS" ? "PAGO_FICHAS" : "PAGO_USDT",
      input.amount,
      pendiente.amount,
      pendiente.consumed,
      reg.id,
      input.notes ?? null,
      input.createdBy ?? null,
    ]
  );
  return pendiente;
}

/**
 * Da de baja un rakeback pendiente sin pagarlo (ej. se decide perdonarlo, o se cargó mal) --
 * queda en 0 disponible, sin generar ningún movimiento de plata. No borra nada (ver
 * eliminarPendiente para eso).
 */
export async function darDeBajaPendiente(pendienteId: string, notes?: string, createdBy?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 AND active = true FOR UPDATE`, [pendienteId]);
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente (o ya está dado de baja).");
    const r = await client.query(`UPDATE rakeback_pendiente SET active = false, updated_at = now() WHERE id = $1 RETURNING *`, [pendienteId]);
    const pendiente = r.rows[0];
    await client.query(
      `INSERT INTO rakeback_pendiente_movements (id, pendiente_id, agent_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
       VALUES ($1,$2,$3,'BAJA',0,$4,$5,$6,$7)`,
      [newId("rpm"), pendiente.id, pendiente.agent_id, pendiente.amount, pendiente.consumed, notes ?? null, createdBy ?? null]
    );
    await client.query("COMMIT");
    return pendiente;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Borrado real de un rakeback pendiente (ej. cargado de prueba) -- bloqueado si ya se pagó algo,
 * mismo criterio que eliminarCarga en repo/cargaCruces.ts.
 */
export async function eliminarPendiente(pendienteId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM rakeback_pendiente WHERE id = $1 FOR UPDATE`, [pendienteId]);
    const actual = existing.rows[0];
    if (!actual) throw new Error("No se encontró ese rakeback pendiente.");
    if (Number(actual.consumed) > 0) {
      throw new Error("Este rakeback pendiente ya tiene pagos aplicados -- no se puede borrar.");
    }
    await client.query(`DELETE FROM rakeback_pendiente_movements WHERE pendiente_id = $1`, [pendienteId]);
    await client.query(`DELETE FROM rakeback_pendiente WHERE id = $1`, [pendienteId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
