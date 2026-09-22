import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";
import { getResumenClubSemanal } from "./clubResumen.js";

// Repositorio de Proveedores (22/09/2026, pedido de Leo) -- entidad separada de agents.
// Ver comentario largo en schema.sql. Mismo criterio de signo que balances: positivo = a
// favor del proveedor (le debemos), negativo = a favor nuestro (nos debe).

export async function listProveedores(includeInactive = false) {
  const where = includeInactive ? "" : "WHERE active = true";
  const r = await pool.query(`SELECT * FROM proveedores ${where} ORDER BY name`);
  return r.rows;
}

export async function crearProveedor(
  name: string,
  notes?: string,
  autoCierreClubId?: string | null,
  autoCierreRakebackPct?: number | null
) {
  const id = newId("prov");
  const r = await pool.query(
    `INSERT INTO proveedores (id, name, notes, active, auto_cierre_club_id, auto_cierre_rakeback_pct)
     VALUES ($1,$2,$3,true,$4,$5) RETURNING *`,
    [id, name.trim(), notes?.trim() || null, autoCierreClubId || null, autoCierreRakebackPct ?? null]
  );
  return r.rows[0];
}

export async function actualizarProveedor(
  id: string,
  patch: {
    name?: string;
    notes?: string | null;
    active?: boolean;
    autoCierreClubId?: string | null;
    autoCierreRakebackPct?: number | null;
  }
) {
  const r = await pool.query(
    `UPDATE proveedores SET
       name = COALESCE($2, name),
       notes = CASE WHEN $3::boolean THEN $4 ELSE notes END,
       active = COALESCE($5, active),
       auto_cierre_club_id = CASE WHEN $6::boolean THEN $7 ELSE auto_cierre_club_id END,
       auto_cierre_rakeback_pct = CASE WHEN $8::boolean THEN $9 ELSE auto_cierre_rakeback_pct END
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.name ?? null,
      patch.notes !== undefined,
      patch.notes ?? null,
      patch.active ?? null,
      patch.autoCierreClubId !== undefined,
      patch.autoCierreClubId || null,
      patch.autoCierreRakebackPct !== undefined,
      patch.autoCierreRakebackPct ?? null,
    ]
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

export type TipoLineaCierreProveedor = "CLUB" | "AGENTE";

export interface LineaCierreProveedorInput {
  tipo: TipoLineaCierreProveedor;
  clubId: string;
  /** Requerido para tipo CLUB (ej. 0.75 = 75%). */
  rakebackPct?: number;
  /** Requerido para tipo AGENTE: el agente cuyo weekly_closing (Cierres semanales) ya
   * aplicado para este club+semana se va a tomar tal cual (ver repo/closings.ts). */
  agentId?: string;
  notes?: string;
}

export interface CierreProveedorInput {
  proveedorId: string;
  weekStart: string; // YYYY-MM-DD
  lineas: LineaCierreProveedorInput[];
  notes?: string;
  createdBy?: string;
}

/**
 * Aplica el cierre semanal de un proveedor, compuesto por una o más líneas (22/09/2026,
 * pedido de Leo -- caso Manzur: una línea CLUB para Fénix GG donde es "la unión" + una
 * línea AGENTE para M CHOCO en Fénix Suprema, que ya tiene su cierre normal en Cierres
 * semanales.
 *
 * Línea CLUB: cierre = resultado_total del club + (rake_total del club × rakeback_pct),
 * sacado de getResumenClubSemanal (mismos totales que "Resumen por club", nunca se re-tipean).
 * Se guarda INVERTIDO (× -1) -- ESTA inversión es exclusiva del cierre de Proveedores, a
 * pedido explícito de Leo (22/09/2026): "tenemos que hacerlo solo para la sección de
 * proveedores... al momento de hacer el cierre dentro de los proveedores que se vaya x -1
 * ahí, no en todo el sistema" -- no toca clubResumen, closings, ledger ni ninguna otra
 * parte del sistema.
 *
 * Línea AGENTE: se busca el weekly_closing YA APLICADO de ese agente+club+semana (Cierres
 * semanales) y se usa su final_closing TAL CUAL, sin invertir. Ver explicación de Leo sobre
 * M CHOCO/Manzur: al pasar de "cierre del agente" a "impacto en Manzur" el signo se invierte
 * una vez; al persistir el impacto de Manzur en el saldo de Proveedores (convención estándar
 * del sistema) se invierte una segunda vez -- las dos inversiones se cancelan, así que la
 * línea de agente entra sin tocar su signo original.
 *
 * Cada línea actualiza el saldo de proveedor_saldos correspondiente a su propio club (un
 * mismo cierre puede tocar varios clubes a la vez, ej. Fénix Suprema y Fénix GG). Todo en
 * una sola transacción: o se aplican todas las líneas, o ninguna.
 */
export async function aplicarCierreProveedor(input: CierreProveedorInput) {
  if (!input.lineas || input.lineas.length === 0) {
    throw new Error("El cierre necesita al menos una línea (club o agente).");
  }
  for (const linea of input.lineas) {
    if (linea.tipo === "CLUB") {
      if (linea.rakebackPct === undefined || linea.rakebackPct < 0 || linea.rakebackPct > 1) {
        throw new Error("El % de rakeback tiene que estar entre 0 y 1 (ej. 0.75 = 75%) en cada línea de club.");
      }
    } else if (linea.tipo === "AGENTE") {
      if (!linea.agentId) throw new Error("Cada línea de tipo agente necesita un agente.");
    } else {
      throw new Error("Tipo de línea inválido.");
    }
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    let weekEnd: string | null = null;
    // Acumula, por club, el saldo corriente DENTRO de este mismo cierre (para que dos líneas
    // del mismo club en un mismo cierre se encadenen bien, en vez de pisarse).
    const saldoPorClub = new Map<string, { id: string; anterior: number; actual: number }>();

    async function getOrInitSaldo(clubId: string) {
      let entry = saldoPorClub.get(clubId);
      if (!entry) {
        const saldo = await getSaldoParaUpdate(client, input.proveedorId, clubId);
        entry = { id: saldo.id, anterior: Number(saldo.amount), actual: Number(saldo.amount) };
        saldoPorClub.set(clubId, entry);
      }
      return entry;
    }

    const lineasPreparadas: Array<{
      tipo: TipoLineaCierreProveedor;
      clubId: string;
      agentId: string | null;
      weeklyClosingId: string | null;
      resultadoTotal: number | null;
      rakeTotal: number | null;
      rakebackPct: number | null;
      montoCrudo: number;
      montoAplicado: number;
      saldoAnterior: number;
      saldoNuevo: number;
      notes: string | null;
    }> = [];

    for (const linea of input.lineas) {
      if (linea.tipo === "CLUB") {
        const resumen = await getResumenClubSemanal(linea.clubId, input.weekStart);
        if (!resumen) throw new Error("Club no encontrado.");
        if (resumen.agentesConCierre === 0) {
          throw new Error(
            `Todavía no hay ningún cierre semanal cargado para "${resumen.clubName ?? "este club"}" en esa semana -- cargá primero el cierre normal en "Cierres semanales" y después aplicá el cierre de proveedor.`
          );
        }
        if (!resumen.weekEnd) throw new Error("El resumen del club no tiene fecha de fin de semana todavía.");
        weekEnd = weekEnd ?? resumen.weekEnd;

        const rakebackMonto = resumen.rakeTotal * (linea.rakebackPct as number);
        const montoCrudo = resumen.resultadoTotal + rakebackMonto;
        const montoAplicado = -montoCrudo; // inversión exclusiva de Proveedores

        const entry = await getOrInitSaldo(linea.clubId);
        const saldoAnterior = entry.actual;
        entry.actual += montoAplicado;

        lineasPreparadas.push({
          tipo: "CLUB",
          clubId: linea.clubId,
          agentId: null,
          weeklyClosingId: null,
          resultadoTotal: resumen.resultadoTotal,
          rakeTotal: resumen.rakeTotal,
          rakebackPct: linea.rakebackPct as number,
          montoCrudo,
          montoAplicado,
          saldoAnterior,
          saldoNuevo: entry.actual,
          notes: linea.notes ?? null,
        });
      } else {
        const wc = await client.query(
          `SELECT wc.*, a.name as agent_name FROM weekly_closings wc
           JOIN agents a ON a.id = wc.agent_id
           WHERE wc.agent_id = $1 AND wc.club_id = $2 AND wc.week_start = $3 AND wc.status <> 'REVERTIDO'
           ORDER BY wc.created_at DESC LIMIT 1`,
          [linea.agentId, linea.clubId, input.weekStart]
        );
        const closing = wc.rows[0];
        if (!closing) {
          throw new Error(
            `El agente no tiene un cierre aplicado en ese club para esa semana -- cargalo primero en "Cierres semanales".`
          );
        }
        weekEnd = weekEnd ?? closing.week_end;

        const montoCrudo = Number(closing.final_closing);
        const montoAplicado = montoCrudo; // sin invertir (las dos inversiones se cancelan)

        const entry = await getOrInitSaldo(linea.clubId);
        const saldoAnterior = entry.actual;
        entry.actual += montoAplicado;

        lineasPreparadas.push({
          tipo: "AGENTE",
          clubId: linea.clubId,
          agentId: linea.agentId as string,
          weeklyClosingId: closing.id,
          resultadoTotal: null,
          rakeTotal: null,
          rakebackPct: null,
          montoCrudo,
          montoAplicado,
          saldoAnterior,
          saldoNuevo: entry.actual,
          notes: linea.notes ?? null,
        });
      }
    }

    if (!weekEnd) throw new Error("No se pudo determinar la fecha de fin de semana.");

    const cierreTotal = lineasPreparadas.reduce((acc, l) => acc + l.montoAplicado, 0);
    const saldoAnteriorTotal = Array.from(saldoPorClub.values()).reduce((acc, s) => acc + s.anterior, 0);
    const saldoNuevoTotal = Array.from(saldoPorClub.values()).reduce((acc, s) => acc + s.actual, 0);

    const id = newId("pcie");
    let row;
    try {
      const r = await client.query(
        `INSERT INTO proveedor_cierres
          (id, proveedor_id, club_id, week_start, week_end, cierre, saldo_anterior, saldo_nuevo, notes, created_by)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          id,
          input.proveedorId,
          input.weekStart,
          weekEnd,
          cierreTotal,
          saldoAnteriorTotal,
          saldoNuevoTotal,
          input.notes ?? null,
          input.createdBy ?? null,
        ]
      );
      row = r.rows[0];
    } catch (err: any) {
      if (err.code === "23505") {
        throw new Error("Ya existe un cierre para este proveedor en esa semana. Revertí el anterior si necesitás cargarlo de nuevo.");
      }
      throw err;
    }

    for (const linea of lineasPreparadas) {
      await client.query(
        `INSERT INTO proveedor_cierre_lineas
          (id, cierre_id, tipo, club_id, agent_id, weekly_closing_id, resultado_total, rake_total,
           rakeback_pct, monto_crudo, monto_aplicado, saldo_anterior, saldo_nuevo, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          newId("pclin"),
          id,
          linea.tipo,
          linea.clubId,
          linea.agentId,
          linea.weeklyClosingId,
          linea.resultadoTotal,
          linea.rakeTotal,
          linea.rakebackPct,
          linea.montoCrudo,
          linea.montoAplicado,
          linea.saldoAnterior,
          linea.saldoNuevo,
          linea.notes,
        ]
      );
    }

    for (const [clubId, entry] of saldoPorClub) {
      await client.query(`UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`, [
        entry.actual,
        entry.id,
      ]);
    }

    await client.query("COMMIT");
    return { ...row, lineas: lineasPreparadas };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Preview para el formulario de "Cierres semanales" en Proveedores: busca el weekly_closing
// ya aplicado de un agente+club+semana (sin aplicar nada) -- para mostrar el monto ANTES de
// que Leo confirme agregar esa línea al cierre del proveedor.
export async function obtenerCierreAgentePreview(agentId: string, clubId: string, weekStart: string) {
  const r = await pool.query(
    `SELECT wc.*, a.name as agent_name, c.name as club_name FROM weekly_closings wc
     JOIN agents a ON a.id = wc.agent_id
     JOIN clubs c ON c.id = wc.club_id
     WHERE wc.agent_id = $1 AND wc.club_id = $2 AND wc.week_start = $3 AND wc.status <> 'REVERTIDO'
     ORDER BY wc.created_at DESC LIMIT 1`,
    [agentId, clubId, weekStart]
  );
  return r.rows[0] ?? null;
}

export async function listLineasCierreProveedor(cierreId: string) {
  const r = await pool.query(
    `SELECT pcl.*, c.name as club_name, a.name as agent_name
     FROM proveedor_cierre_lineas pcl
     JOIN clubs c ON c.id = pcl.club_id
     LEFT JOIN agents a ON a.id = pcl.agent_id
     WHERE pcl.cierre_id = $1
     ORDER BY pcl.created_at`,
    [cierreId]
  );
  return r.rows;
}

export async function revertirCierreProveedor(id: string) {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(`SELECT * FROM proveedor_cierres WHERE id = $1 FOR UPDATE`, [id]);
    const cierre = r.rows[0];
    if (!cierre) throw new Error("Cierre no encontrado.");
    if (cierre.status === "REVERTIDO") throw new Error("Este cierre ya fue revertido.");

    const lineasR = await client.query(
      `SELECT * FROM proveedor_cierre_lineas WHERE cierre_id = $1 ORDER BY created_at`,
      [id]
    );
    const lineas = lineasR.rows;
    if (lineas.length === 0) {
      throw new Error("Este cierre no tiene líneas registradas -- no se puede revertir de forma segura (¿es un cierre viejo del formato anterior?).");
    }

    // Agrupa por club: la primera línea de cada club marca el saldo "antes" de este cierre,
    // la última marca el saldo "después" -- así dos líneas del mismo club dentro de un mismo
    // cierre (poco común, pero posible) se revierten juntas de forma consistente.
    const porClub = new Map<string, { primeraAnterior: number; ultimaNueva: number }>();
    for (const l of lineas) {
      const clubId = l.club_id as string;
      const existente = porClub.get(clubId);
      if (!existente) {
        porClub.set(clubId, { primeraAnterior: Number(l.saldo_anterior), ultimaNueva: Number(l.saldo_nuevo) });
      } else {
        existente.ultimaNueva = Number(l.saldo_nuevo);
      }
    }

    for (const [clubId, { primeraAnterior, ultimaNueva }] of porClub) {
      const saldo = await getSaldoParaUpdate(client, cierre.proveedor_id, clubId);
      if (Number(saldo.amount) !== ultimaNueva) {
        throw new Error(
          "El saldo del proveedor cambió desde este cierre (hay pagos o cierres más nuevos encima) -- no se puede revertir sin desarmar antes lo que se aplicó después."
        );
      }
      await client.query(`UPDATE proveedor_saldos SET amount = $1, updated_at = now() WHERE id = $2`, [
        primeraAnterior,
        saldo.id,
      ]);
    }

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

// Auto-cierre (22/09/2026, pedido de Leo): se llama desde el guardado de "Resumen por club"
// (routes/dashboard.ts, POST /resumen-club/extras) -- busca todos los proveedores que tengan
// este club como auto_cierre_club_id y les aplica el cierre semanal solo, sin que Leo tenga
// que ir a la pestaña Proveedores y tocar nada. Por ahora el auto-cierre siempre genera una
// única línea de tipo CLUB (el caso simple); líneas de agente se siguen cargando a mano desde
// "Cierres semanales" en Proveedores. Si un proveedor ya tiene el cierre de esa
// semana aplicado (por ejemplo porque el resumen se guardó dos veces), se lo salta sin error
// -- nunca duplica ni revienta el guardado del resumen del club por esto.
export interface ResultadoAutoCierreProveedor {
  proveedorId: string;
  proveedorName: string;
  applied: boolean;
  cierre?: number;
  reason?: string;
}

export async function aplicarCierresAutomaticosParaClub(
  clubId: string,
  weekStart: string,
  createdBy?: string
): Promise<ResultadoAutoCierreProveedor[]> {
  const r = await pool.query(
    `SELECT id, name, auto_cierre_rakeback_pct FROM proveedores
     WHERE active = true AND auto_cierre_club_id = $1 AND auto_cierre_rakeback_pct IS NOT NULL`,
    [clubId]
  );
  const resultados: ResultadoAutoCierreProveedor[] = [];
  for (const p of r.rows) {
    try {
      const cierre = await aplicarCierreProveedor({
        proveedorId: p.id,
        weekStart,
        lineas: [{ tipo: "CLUB", clubId, rakebackPct: Number(p.auto_cierre_rakeback_pct) }],
        notes: "Cierre automático al guardar el resumen semanal del club.",
        createdBy,
      });
      resultados.push({ proveedorId: p.id, proveedorName: p.name, applied: true, cierre: Number(cierre.cierre) });
    } catch (err: any) {
      // "Ya existe un cierre..." es el caso normal de re-guardar el resumen -- no es un error
      // real, solo significa que este proveedor ya estaba cerrado para esta semana.
      resultados.push({ proveedorId: p.id, proveedorName: p.name, applied: false, reason: err.message });
    }
  }
  return resultados;
}

export async function listCierresProveedor(proveedorId?: string) {
  const where = proveedorId ? "WHERE pc.proveedor_id = $1" : "";
  const values = proveedorId ? [proveedorId] : [];
  const r = await pool.query(
    `SELECT pc.*, p.name as proveedor_name
     FROM proveedor_cierres pc
     JOIN proveedores p ON p.id = pc.proveedor_id
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
