import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";

// Repositorio de Proveedores (22/09/2026, pedido de Leo) -- entidad separada de agents.
// Ver comentario largo en schema.sql. Mismo criterio de signo que balances: positivo = a
// favor del proveedor (le debemos), negativo = a favor nuestro (nos debe).

export async function listProveedores(includeInactive = false) {
  const where = includeInactive ? "" : "WHERE active = true";
  const r = await pool.query(`SELECT * FROM proveedores ${where} ORDER BY name`);
  return r.rows;
}

export async function crearProveedor(name: string, notes?: string) {
  const id = newId("prov");
  const r = await pool.query(
    `INSERT INTO proveedores (id, name, notes, active) VALUES ($1,$2,$3,true) RETURNING *`,
    [id, name.trim(), notes?.trim() || null]
  );
  return r.rows[0];
}

export async function actualizarProveedor(id: string, patch: { name?: string; notes?: string | null; active?: boolean }) {
  const r = await pool.query(
    `UPDATE proveedores SET
       name = COALESCE($2, name),
       notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
       active = COALESCE($5, active)
     WHERE id = $1 RETURNING *`,
    [id, patch.name ?? null, patch.notes !== undefined, patch.notes ?? null, patch.active ?? null]
  );
  if (!r.rows[0]) throw new Error("Proveedor no encontrado.");
  return r.rows[0];
}

export async function listSaldosProveedores() {
  const r = await pool.query(
    `SELECT ps.*, p.name as proveedor_name, c.name as club_name
     FROM proveedor_saldos ps
     JOIN proveedores p ON p.id = ps.proveedor_id
     JOIN clubs c ON c.id = ps.club_id
     ORDER BY p.name, c.name`
  );
  return r.rows;
}

async function getSaldoParaUpdate(client: PoolClient, proveedorId: string, clubId: string) {
  const existing = await client.query(
    `SELECT * FROM proveedor_saldos WHERE proveedor_id = $1 AND club_id = $2 FOR UPDATE`,
    [proveedorId, clubId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await client.query(
    `INSERT INTO proveedor_saldos (id, proveedor_id, club_id, amount) VALUES ($1,$2,$3,0) RETURNING *`,
    [newId("psal"), proveedorId, clubId]
  );
  return r.rows[0];
}

export interface CierreProveedorInput {
  proveedorId: string;
  clubId: string;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string;
  resultadoTotal: number;
  rakeTotal: number;
  rakebackPct: number; // ej. 0.75
  notes?: string;
  createdBy?: string;
}

/**
 * Aplica el cierre semanal de un proveedor: cierre = resultado_total + (rake_total ×
 * rakeback_pct). Actualiza el saldo acumulado del proveedor+club de forma atómica y deja el
 * saldo_anterior/saldo_nuevo registrado en la fila para poder revertir sin ambigüedad.
 */
export async function aplicarCierreProveedor(input: CierreProveedorInput) {
  if (input.rakebackPct < 0 || input.rakebackPct > 1) {
    throw new Error("El % de rakeback tiene que estar entre 0 y 1 (ej. 0.75 = 75%).");
  }
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const saldo = await getSaldoParaUpdate(client, input.proveedorId, input.clubId);
    const rakebackMonto = input.rakeTotal * input.rakebackPct;
    const cierre = input.resultadoTotal + rakebackMonto;
    const saldoAnterior = Number(saldo.amount);
    const saldoNuevo = saldoAnterior + cierre;

    const id = newId("pcie");
    let row;
    try {
      const r = await client.query(
        `INSERT INTO proveedor_cierres
          (id, proveedor_id, club_id, week_start, week_end, resultado_total, rake_total,
           rakeback_pct, rakeback_monto, cierre, saldo_anterior, saldo_nuevo, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          id,
          input.proveedorId,
          input.clubId,
          input.weekStart,
          input.weekEnd,
          input.resultadoTotal,
          input.rakeTotal,
          input.rakebackPct,
          rakebackMonto,
          cierre,
          saldoAnterior,
          saldoNuevo,
          input.notes ?? null,
          input.createdBy ?? null,
        ]
      );
      row = r.rows[0];
    } catch (err: any) {
      if (err.code === "23505") {
        throw new Error("Ya existe un cierre para este proveedor+club en esa semana (week_start). Revertí el anterior si necesitás cargarlo de nuevo.");
      }
      throw err;
    }

    await client.query(
      `UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`,
      [saldoNuevo, saldo.id]
    );

    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revertirCierreProveedor(id: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT * FROM proveedor_cierres WHERE id = $1 FOR UPDATE`, [id]);
    const cierre = r.rows[0];
    if (!cierre) throw new Error("Cierre no encontrado.");
    if (cierre.status === "REVERTIDO") throw new Error("Este cierre ya fue revertido.");

    const saldo = await getSaldoParaUpdate(client, cierre.proveedor_id, cierre.club_id);
    if (Number(saldo.amount) !== Number(cierre.saldo_nuevo)) {
      throw new Error(
        "El saldo del proveedor cambió desde este cierre (hay pagos o cierres más nuevos encima) -- no se puede revertir sin desarmar antes lo que se aplicó después."
      );
    }

    await client.query(`UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`, [
      cierre.saldo_anterior,
      saldo.id,
    ]);
    await client.query(`UPDATE proveedor_cierres SET status = 'REVERTIDO' WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listCierresProveedor(proveedorId?: string) {
  const where = proveedorId ? "WHERE pc.proveedor_id = $1" : "";
  const values = proveedorId ? [proveedorId] : [];
  const r = await pool.query(
    `SELECT pc.*, p.name as proveedor_name, c.name as club_name
     FROM proveedor_cierres pc
     JOIN proveedores p ON p.id = pc.proveedor_id
     JOIN clubs c ON c.id = pc.club_id
     ${where}
     ORDER BY pc.week_start DESC, pc.created_at DESC
     LIMIT 500`,
    values
  );
  return r.rows;
}

export interface PagoProveedorInput {
  proveedorId: string;
  clubId: string;
  amount: number; // siempre positivo
  medio: "USDT" | "EFECTIVO" | "ZELLE" | "OTRO";
  direction: "PAGO" | "COBRO"; // PAGO = le pagamos (resta saldo a favor del proveedor); COBRO = nos paga (suma)
  notes?: string;
  createdBy?: string;
}

/**
 * Registra un pago/cobro contra el saldo del proveedor, separado del cierre semanal (Leo:
 * "los pagos USDT deben mostrarse por separado y aplicarse al saldo, no modificando la
 * fórmula del cierre semanal"). PAGO resta del saldo a favor del proveedor (ya le dimos esa
 * plata), COBRO lo suma (nos devolvió/pagó algo).
 */
export async function registrarPagoProveedor(input: PagoProveedorInput) {
  if (input.amount <= 0) throw new Error("El monto tiene que ser mayor a 0.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const saldo = await getSaldoParaUpdate(client, input.proveedorId, input.clubId);
    const delta = input.direction === "PAGO" ? -Math.abs(input.amount) : Math.abs(input.amount);
    const saldoAnterior = Number(saldo.amount);
    const saldoNuevo = saldoAnterior + delta;

    const id = newId("ppag");
    const r = await client.query(
      `INSERT INTO proveedor_pagos
        (id, proveedor_id, club_id, amount, medio, direction, saldo_anterior, saldo_nuevo, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        input.proveedorId,
        input.clubId,
        Math.abs(input.amount),
        input.medio,
        input.direction,
        saldoAnterior,
        saldoNuevo,
        input.notes ?? null,
        input.createdBy ?? null,
      ]
    );

    await client.query(`UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`, [saldoNuevo, saldo.id]);

    await client.query("COMMIT");
    return r.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revertirPagoProveedor(id: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT * FROM proveedor_pagos WHERE id = $1 FOR UPDATE`, [id]);
    const pago = r.rows[0];
    if (!pago) throw new Error("Pago no encontrado.");
    if (pago.status === "REVERTIDO") throw new Error("Este pago ya fue revertido.");

    const saldo = await getSaldoParaUpdate(client, pago.proveedor_id, pago.club_id);
    if (Number(saldo.amount) !== Number(pago.saldo_nuevo)) {
      throw new Error(
        "El saldo del proveedor cambió desde este pago (hay movimientos más nuevos encima) -- no se puede revertir sin desarmar antes lo que se aplicó después."
      );
    }

    await client.query(`UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`, [
      pago.saldo_anterior,
      saldo.id,
    ]);
    await client.query(`UPDATE proveedor_pagos SET status = 'REVERTIDO' WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return { ok: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listPagosProveedor(proveedorId?: string) {
  const where = proveedorId ? "WHERE pp.proveedor_id = $1" : "";
  const values = proveedorId ? [proveedorId] : [];
  const r = await pool.query(
    `SELECT pp.*, p.name as proveedor_name, c.name as club_name
     FROM proveedor_pagos pp
     JOIN proveedores p ON p.id = pp.proveedor_id
     JOIN clubs c ON c.id = pp.club_id
     ${where}
     ORDER BY pp.occurred_at DESC
     LIMIT 500`,
    values
  );
  return r.rows;
}

// ---- Garantía de proveedor (mismo patrón que repo/guarantees.ts, tabla separada) ----

export type ProveedorGuaranteeMovementType = "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA";

export interface AjusteGarantiaProveedorInput {
  proveedorId: string;
  type: ProveedorGuaranteeMovementType;
  amount: number;
  notes?: string;
  createdBy?: string;
}

export async function listGarantiasProveedores() {
  const r = await pool.query(
    `SELECT g.*, p.name as proveedor_name
     FROM proveedor_garantias g JOIN proveedores p ON p.id = g.proveedor_id
     WHERE g.active = true
     ORDER BY p.name`
  );
  return r.rows;
}

export async function listGarantiaProveedorMovements(proveedorId?: string) {
  const where = proveedorId ? `WHERE m.proveedor_id = $1` : "";
  const values = proveedorId ? [proveedorId] : [];
  const r = await pool.query(
    `SELECT m.*, p.name as proveedor_name
     FROM proveedor_garantia_movements m JOIN proveedores p ON p.id = m.proveedor_id
     ${where}
     ORDER BY m.occurred_at DESC
     LIMIT 500`,
    values
  );
  return r.rows;
}

export async function ajustarGarantiaProveedor(input: AjusteGarantiaProveedorInput) {
  if (input.amount < 0) throw new Error("El monto tiene que ser positivo — el tipo de movimiento ya define si suma o resta.");
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT * FROM proveedor_garantias WHERE proveedor_id = $1 AND active = true ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [input.proveedorId]
    );
    const actual = existing.rows[0] ?? null;

    if (input.type === "ALTA") {
      if (actual) throw new Error("El proveedor ya tiene una garantía activa — usá 'Aumentar' en vez de 'Alta', o dala de baja primero.");
      const id = newId("pgua");
      const r = await client.query(
        `INSERT INTO proveedor_garantias (id, proveedor_id, amount, consumed, active, notes) VALUES ($1,$2,$3,0,true,$4) RETURNING *`,
        [id, input.proveedorId, input.amount, input.notes ?? null]
      );
      const garantia = r.rows[0];
      await registrarMovimientoGarantia(client, garantia, "ALTA", input.amount, input.notes, input.createdBy);
      await client.query("COMMIT");
      return garantia;
    }

    if (!actual) throw new Error("El proveedor no tiene una garantía activa todavía — usá 'Alta' primero.");

    let nuevoAmount = Number(actual.amount);
    let nuevoConsumed = Number(actual.consumed);
    let nuevoActive = true;

    if (input.type === "AUMENTO") {
      nuevoAmount += input.amount;
    } else if (input.type === "REDUCCION") {
      nuevoAmount -= input.amount;
      if (nuevoAmount < 0) throw new Error("La reducción no puede dejar la garantía en negativo.");
      if (nuevoAmount < nuevoConsumed) throw new Error("La garantía no puede quedar por debajo de lo ya consumido.");
    } else if (input.type === "CONSUMO") {
      nuevoConsumed += input.amount;
      if (nuevoConsumed > nuevoAmount) throw new Error("El consumo no puede superar el monto total de la garantía.");
    } else if (input.type === "BAJA") {
      nuevoActive = false;
    }

    const r = await client.query(
      `UPDATE proveedor_garantias SET amount=$1, consumed=$2, active=$3, notes=COALESCE($4, notes), updated_at=now()
       WHERE id=$5 RETURNING *`,
      [nuevoAmount, nuevoConsumed, nuevoActive, input.notes ?? null, actual.id]
    );
    const garantia = r.rows[0];
    await registrarMovimientoGarantia(client, garantia, input.type, input.amount, input.notes, input.createdBy);
    await client.query("COMMIT");
    return garantia;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function registrarMovimientoGarantia(
  client: PoolClient,
  garantia: any,
  type: ProveedorGuaranteeMovementType,
  amount: number,
  notes: string | undefined,
  createdBy: string | undefined
) {
  await client.query(
    `INSERT INTO proveedor_garantia_movements (id, proveedor_id, garantia_id, type, amount, resulting_amount, resulting_consumed, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      newId("pguamov"),
      garantia.proveedor_id,
      garantia.id,
      type,
      amount,
      garantia.amount,
      garantia.consumed,
      notes ?? null,
      createdBy ?? null,
    ]
  );
}
