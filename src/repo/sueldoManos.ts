// Sueldo de Manos (03/11/2026, pedido de Leo): 10% de la ganancia neta final de cada período
// cerrado, con un mínimo de US$ 400. Tiene dos efectos, en dos momentos distintos y nunca dos
// veces:
//   A. Al cerrar el período (cerrarPeriodo → generarSueldoEnCierre): queda un sueldo PENDIENTE y
//      la ganancia disponible para socios es la neta final menos el sueldo. Solo eso -- no toca
//      la cuenta de Juan, ni la de Manos, ni Wallet Manos.
//   B. Al registrar el pago (registrarPagoSueldo): Juan lo paga en pesos en nombre de la empresa,
//      así que se le baja la deuda con un movimiento PAGO en su cuenta (categoría que no entra en
//      gastos/ajustes/retiros, para no volver a restarlo de ninguna ganancia). No mueve Wallet
//      Manos (el movimiento no lleva treasury_adjustment_id) ni la cuenta de Manos.
// Un único sueldo por período: period_id e idempotency_key (SUELDO_MANOS-<periodo>) son UNIQUE en
// la base, y el movimiento de Juan usa su propia clave idempotente.
import type { PoolClient } from "pg";
import { pool, newId } from "../db/pool.js";

export const SUELDO_MANOS_PORCENTAJE = 0.1;
export const SUELDO_MANOS_MINIMO = 400;
const TOLERANCIA_PAGO = 0.01;
const OBSERVACION_PAGO = "Pagado en ARS por Juan; reduce su deuda y no mueve Wallet Manos";

export type EstadoSueldo = "PENDIENTE" | "PAGADO" | "REVISAR_DIFERENCIA" | "REQUIERE_REVISION";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

let tablaLista: Promise<void> | null = null;
export function asegurarTablaSueldosManos(): Promise<void> {
  tablaLista ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS manos_sueldos (
        id                         TEXT PRIMARY KEY,
        period_id                  TEXT NOT NULL UNIQUE REFERENCES profit_periods(id),
        period_name                TEXT NOT NULL,
        generado_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
        base_calculo_usdt          NUMERIC(18,4) NOT NULL,
        porcentaje                 NUMERIC(8,4) NOT NULL,
        minimo_usdt                NUMERIC(18,4) NOT NULL,
        sueldo_usdt                NUMERIC(18,4) NOT NULL,
        ganancia_disponible_socios NUMERIC(18,4) NOT NULL,
        regla_manual               BOOLEAN NOT NULL DEFAULT FALSE,
        estado                     TEXT NOT NULL DEFAULT 'PENDIENTE'
                                   CHECK (estado IN ('PENDIENTE','PAGADO','REVISAR_DIFERENCIA','REQUIERE_REVISION')),
        fecha_pago                 DATE,
        pesos_pagados              NUMERIC(18,2),
        cotizacion_ars_usdt        NUMERIC(18,4),
        equivalente_usdt           NUMERIC(18,4),
        cuenta_pagadora            TEXT REFERENCES partner_accounts(id),
        movimiento_cuenta_juan_id  TEXT REFERENCES partner_account_entries(id),
        revision_base_usdt         NUMERIC(18,4),
        revision_sueldo_usdt       NUMERIC(18,4),
        movimiento_complemento_id  TEXT REFERENCES partner_account_entries(id),
        idempotency_key            TEXT NOT NULL UNIQUE,
        observaciones              TEXT,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    )
    .then(() => undefined)
    .catch((err) => {
      tablaLista = null;
      throw err;
    });
  return tablaLista;
}

export function calcularSueldoManos(gananciaNetaFinal: number) {
  const base = round2(gananciaNetaFinal);
  const sueldo = Math.max(SUELDO_MANOS_MINIMO, round2(base * SUELDO_MANOS_PORCENTAJE));
  return {
    base,
    porcentaje: SUELDO_MANOS_PORCENTAJE,
    minimo: SUELDO_MANOS_MINIMO,
    sueldo,
    aplicaMinimo: sueldo === SUELDO_MANOS_MINIMO && round2(base * SUELDO_MANOS_PORCENTAJE) < SUELDO_MANOS_MINIMO,
    gananciaDisponibleSocios: round2(base - sueldo),
  };
}

function agregarObservacion(actual: string | null, nueva: string): string {
  return actual ? `${actual}\n${nueva}` : nueva;
}

/** Se llama dentro de la transacción de cerrarPeriodo, con la ganancia neta final ya calculada.
 * Crea el sueldo PENDIENTE, o -- si el período se había cerrado antes y se reabrió -- actualiza el
 * mismo registro (nunca crea un segundo). Un sueldo ya pagado no se toca: si el importe cambió,
 * queda en REQUIERE_REVISION con la diferencia, hasta que alguien decida qué hacer. */
export async function generarSueldoEnCierre(client: PoolClient, periodo: { id: string; name: string }, gananciaNetaFinal: number) {
  await asegurarTablaSueldosManos();
  const calc = calcularSueldoManos(gananciaNetaFinal);
  await client.query(
    `INSERT INTO manos_sueldos (id, period_id, period_name, base_calculo_usdt, porcentaje, minimo_usdt, sueldo_usdt,
       ganancia_disponible_socios, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (period_id) DO NOTHING`,
    [newId("sueldo"), periodo.id, periodo.name, calc.base, calc.porcentaje, calc.minimo, calc.sueldo, calc.gananciaDisponibleSocios, `SUELDO_MANOS-${periodo.id}`]
  );
  const r = await client.query(`SELECT * FROM manos_sueldos WHERE period_id = $1 FOR UPDATE`, [periodo.id]);
  const s = r.rows[0];

  if (s.estado === "PENDIENTE" || s.estado === "REVISAR_DIFERENCIA") {
    // Todavía no se le bajó la deuda a Juan: se recalcula entero con la ganancia nueva.
    await client.query(
      `UPDATE manos_sueldos SET period_name = $2, base_calculo_usdt = $3, porcentaje = $4, minimo_usdt = $5, sueldo_usdt = $6,
         ganancia_disponible_socios = $7, regla_manual = FALSE, updated_at = now()
       WHERE id = $1`,
      [s.id, periodo.name, calc.base, calc.porcentaje, calc.minimo, calc.sueldo, calc.gananciaDisponibleSocios]
    );
    return;
  }

  // PAGADO o REQUIERE_REVISION: el sueldo pagado queda como está; la ganancia disponible se
  // recalcula contra ese importe. Un sueldo cargado a mano (regla_manual, ej. el de septiembre)
  // no se compara contra la regla.
  const sueldoPagado = Number(s.sueldo_usdt);
  const disponible = round2(calc.base - sueldoPagado);
  if (s.regla_manual || Math.abs(calc.sueldo - sueldoPagado) <= TOLERANCIA_PAGO) {
    await client.query(
      `UPDATE manos_sueldos SET period_name = $2, base_calculo_usdt = $3, ganancia_disponible_socios = $4, estado = 'PAGADO',
         revision_base_usdt = NULL, revision_sueldo_usdt = NULL, updated_at = now()
       WHERE id = $1`,
      [s.id, periodo.name, calc.base, disponible]
    );
    return;
  }
  await client.query(
    `UPDATE manos_sueldos SET period_name = $2, ganancia_disponible_socios = $3, estado = 'REQUIERE_REVISION',
       revision_base_usdt = $4, revision_sueldo_usdt = $5, observaciones = $6, updated_at = now()
     WHERE id = $1`,
    [
      s.id,
      periodo.name,
      disponible,
      calc.base,
      calc.sueldo,
      agregarObservacion(
        s.observaciones,
        `${new Date().toISOString().slice(0, 10)}: el período se volvió a cerrar con ganancia neta ${calc.base.toFixed(2)}; con la regla el sueldo sería ${calc.sueldo.toFixed(2)} y se pagó ${sueldoPagado.toFixed(2)}.`
      ),
    ]
  );
}

export async function getSueldoDePeriodo(periodId: string) {
  await asegurarTablaSueldosManos();
  const r = await pool.query(`SELECT * FROM manos_sueldos WHERE period_id = $1`, [periodId]);
  return r.rows[0] ?? null;
}

/** Suma de sueldos de los períodos CERRADOS -- lo que se descuenta de la ganancia histórica de
 * los socios (Cuentas de socios). Un período reabierto no cuenta hasta volver a cerrarse. */
export async function totalSueldosPeriodosCerrados(): Promise<number> {
  await asegurarTablaSueldosManos();
  const r = await pool.query(
    `SELECT COALESCE(SUM(s.sueldo_usdt), 0) AS total
     FROM manos_sueldos s JOIN profit_periods p ON p.id = s.period_id
     WHERE p.status = 'CERRADO'`
  );
  return Number(r.rows[0].total);
}

/** Si el movimiento de Cuentas de socios es el pago de un sueldo, devuelve el nombre del período
 * (para bloquear editarlo o borrarlo desde ahí: se maneja desde Ganancias por período). */
export async function periodoDeMovimientoDeSueldo(entryId: string): Promise<string | null> {
  await asegurarTablaSueldosManos();
  const r = await pool.query(
    `SELECT period_name FROM manos_sueldos WHERE movimiento_cuenta_juan_id = $1 OR movimiento_complemento_id = $1 LIMIT 1`,
    [entryId]
  );
  return r.rows[0]?.period_name ?? null;
}

async function cuentaDeJuan(client: PoolClient): Promise<string> {
  const r = await client.query(
    `SELECT id FROM partner_accounts WHERE id = 'juan' OR lower(name) = 'juan' ORDER BY (id = 'juan') DESC LIMIT 1`
  );
  if (!r.rows[0]) throw new Error("No se encontró la cuenta de Juan en Cuentas de socios.");
  return r.rows[0].id;
}

function validarPago(input: { fechaPago: string; pesos: number; cotizacion: number }) {
  if (!input.fechaPago) throw new Error("La fecha de pago es obligatoria.");
  if (!(input.pesos > 0)) throw new Error("Los pesos pagados tienen que ser mayores a 0.");
  if (!(input.cotizacion > 0)) throw new Error("La cotización tiene que ser mayor a 0.");
  return round2(input.pesos / input.cotizacion);
}

async function crearMovimientoJuan(
  client: PoolClient,
  datos: { cuentaId: string; sueldo: any; monto: number; fecha: string; pesos: number | null; cotizacion: number | null; equivalente: number; clave: string; concepto: string; extra?: string }
) {
  const notas = [
    OBSERVACION_PAGO + ".",
    `Período: ${datos.sueldo.period_name} (${datos.sueldo.period_id}) · sueldo ${datos.sueldo.id}.`,
    datos.pesos != null ? `Pesos pagados: ${datos.pesos} · cotización ARS/USDT: ${datos.cotizacion} · equivalente: US$ ${datos.equivalente.toFixed(2)}.` : null,
    datos.extra ?? null,
  ]
    .filter(Boolean)
    .join(" ");
  const id = newId("pentry");
  await client.query(
    `INSERT INTO partner_account_entries (id, account_id, category, concept, amount, entry_date, notes, idempotency_key)
     VALUES ($1,$2,'PAGO',$3,$4,$5,$6,$7)`,
    [id, datos.cuentaId, datos.concepto, -datos.monto, datos.fecha, notas, datos.clave]
  );
  return id;
}

async function conSueldo<T>(id: string, fn: (client: PoolClient, s: any) => Promise<T>): Promise<T> {
  await asegurarTablaSueldosManos();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT s.*, p.status AS period_status FROM manos_sueldos s JOIN profit_periods p ON p.id = s.period_id WHERE s.id = $1 FOR UPDATE OF s`,
      [id]
    );
    if (!r.rows[0]) throw new Error("No se encontró ese sueldo.");
    const out = await fn(client, r.rows[0]);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function leerSueldo(client: PoolClient, id: string) {
  return (await client.query(`SELECT * FROM manos_sueldos WHERE id = $1`, [id])).rows[0];
}

/** Registra el pago en pesos. Si el equivalente coincide con el sueldo (±0,01) queda PAGADO y se
 * baja la deuda de Juan; si no, queda en REVISAR_DIFERENCIA sin tocar ninguna cuenta. */
export async function registrarPagoSueldo(id: string, input: { fechaPago: string; pesos: number; cotizacion: number; observaciones?: string | null }) {
  return conSueldo(id, async (client, s) => {
    if (s.period_status !== "CERRADO") throw new Error("El período está abierto: cerralo antes de registrar el pago del sueldo.");
    if (s.estado !== "PENDIENTE" && s.estado !== "REVISAR_DIFERENCIA") throw new Error("Este sueldo ya está pagado.");
    const equivalente = validarPago(input);
    const sueldo = Number(s.sueldo_usdt);
    const diferencia = round2(equivalente - sueldo);
    const obs = input.observaciones?.trim() ? agregarObservacion(s.observaciones, input.observaciones.trim()) : s.observaciones;

    if (Math.abs(diferencia) > TOLERANCIA_PAGO) {
      await client.query(
        `UPDATE manos_sueldos SET estado = 'REVISAR_DIFERENCIA', fecha_pago = $2, pesos_pagados = $3, cotizacion_ars_usdt = $4,
           equivalente_usdt = $5, observaciones = $6, updated_at = now()
         WHERE id = $1`,
        [id, input.fechaPago, input.pesos, input.cotizacion, equivalente, obs]
      );
      return { sueldo: await leerSueldo(client, id), esperado: sueldo, equivalente, diferencia };
    }

    const cuentaId = await cuentaDeJuan(client);
    const movId = await crearMovimientoJuan(client, {
      cuentaId,
      sueldo: s,
      monto: sueldo,
      fecha: input.fechaPago,
      pesos: input.pesos,
      cotizacion: input.cotizacion,
      equivalente,
      clave: `SUELDO_MANOS_PAGO-${s.period_id}`,
      concepto: `Sueldo Manos · ${s.period_name}`,
    });
    await client.query(
      `UPDATE manos_sueldos SET estado = 'PAGADO', fecha_pago = $2, pesos_pagados = $3, cotizacion_ars_usdt = $4, equivalente_usdt = $5,
         cuenta_pagadora = $6, movimiento_cuenta_juan_id = $7, observaciones = $8, updated_at = now()
       WHERE id = $1`,
      [id, input.fechaPago, input.pesos, input.cotizacion, equivalente, cuentaId, movId, obs]
    );
    return { sueldo: await leerSueldo(client, id), esperado: sueldo, equivalente, diferencia };
  });
}

/** Desde REVISAR_DIFERENCIA: se da por bueno lo que pagó Juan. A Juan se le baja lo que
 * realmente pagó (el equivalente), el sueldo del período no cambia. */
export async function aceptarDiferenciaSueldo(id: string, usuario?: string | null) {
  return conSueldo(id, async (client, s) => {
    if (s.estado !== "REVISAR_DIFERENCIA") throw new Error("Este sueldo no tiene una diferencia para aceptar.");
    if (s.period_status !== "CERRADO") throw new Error("El período está abierto: cerralo antes de registrar el pago del sueldo.");
    const equivalente = Number(s.equivalente_usdt);
    const diferencia = round2(equivalente - Number(s.sueldo_usdt));
    const cuentaId = await cuentaDeJuan(client);
    const movId = await crearMovimientoJuan(client, {
      cuentaId,
      sueldo: s,
      monto: equivalente,
      fecha: String(s.fecha_pago instanceof Date ? s.fecha_pago.toISOString().slice(0, 10) : s.fecha_pago),
      pesos: Number(s.pesos_pagados),
      cotizacion: Number(s.cotizacion_ars_usdt),
      equivalente,
      clave: `SUELDO_MANOS_PAGO-${s.period_id}`,
      concepto: `Sueldo Manos · ${s.period_name}`,
      extra: `Diferencia aceptada contra el sueldo de US$ ${Number(s.sueldo_usdt).toFixed(2)}: ${diferencia.toFixed(2)}.`,
    });
    await client.query(
      `UPDATE manos_sueldos SET estado = 'PAGADO', cuenta_pagadora = $2, movimiento_cuenta_juan_id = $3, observaciones = $4, updated_at = now()
       WHERE id = $1`,
      [
        id,
        cuentaId,
        movId,
        agregarObservacion(s.observaciones, `Diferencia de US$ ${diferencia.toFixed(2)} aceptada${usuario ? ` por ${usuario}` : ""}; a Juan se le bajó lo pagado (US$ ${equivalente.toFixed(2)}).`),
      ]
    );
    return leerSueldo(client, id);
  });
}

/** Desde REQUIERE_REVISION (período reabierto y vuelto a cerrar con otra ganancia, con el sueldo
 * ya pagado). MANTENER deja el sueldo pagado como definitivo. AJUSTAR pasa al importe nuevo y,
 * como es más alto, registra el pago complementario en pesos (baja la deuda de Juan por la
 * diferencia). Si el importe nuevo es más bajo, se pagó de más: eso no se ajusta solo. */
export async function resolverRevisionSueldo(
  id: string,
  input: { accion: "MANTENER" | "AJUSTAR"; fechaPago?: string; pesos?: number; cotizacion?: number },
  usuario?: string | null
) {
  return conSueldo(id, async (client, s) => {
    if (s.estado !== "REQUIERE_REVISION") throw new Error("Este sueldo no requiere revisión.");
    const hoy = new Date().toISOString().slice(0, 10);
    if (input.accion === "MANTENER") {
      await client.query(
        `UPDATE manos_sueldos SET estado = 'PAGADO', base_calculo_usdt = COALESCE(revision_base_usdt, base_calculo_usdt),
           revision_base_usdt = NULL, revision_sueldo_usdt = NULL, observaciones = $2, updated_at = now()
         WHERE id = $1`,
        [id, agregarObservacion(s.observaciones, `${hoy}: se mantuvo el sueldo pagado de US$ ${Number(s.sueldo_usdt).toFixed(2)}${usuario ? ` (${usuario})` : ""}.`)]
      );
      return leerSueldo(client, id);
    }
    if (s.period_status !== "CERRADO") throw new Error("El período está abierto: cerralo antes de ajustar el sueldo.");
    if (s.movimiento_complemento_id) throw new Error("Este sueldo ya tiene un pago complementario registrado.");
    const nuevoSueldo = Number(s.revision_sueldo_usdt);
    const nuevaBase = Number(s.revision_base_usdt);
    const diferencia = round2(nuevoSueldo - Number(s.sueldo_usdt));
    if (diferencia <= 0) {
      throw new Error(
        `Con la ganancia nueva el sueldo baja US$ ${Math.abs(diferencia).toFixed(2)}: se pagó de más. Eso no se ajusta solo; mantené el sueldo pagado y registrá la devolución aparte.`
      );
    }
    const equivalente = validarPago({ fechaPago: input.fechaPago ?? "", pesos: input.pesos ?? 0, cotizacion: input.cotizacion ?? 0 });
    if (Math.abs(equivalente - diferencia) > TOLERANCIA_PAGO) {
      throw new Error(`El complemento tiene que ser US$ ${diferencia.toFixed(2)}; con esos pesos y esa cotización da US$ ${equivalente.toFixed(2)}.`);
    }
    const cuentaId = await cuentaDeJuan(client);
    const movId = await crearMovimientoJuan(client, {
      cuentaId,
      sueldo: s,
      monto: diferencia,
      fecha: input.fechaPago!,
      pesos: input.pesos!,
      cotizacion: input.cotizacion!,
      equivalente,
      clave: `SUELDO_MANOS_COMPLEMENTO-${s.period_id}`,
      concepto: `Sueldo Manos · ${s.period_name} (complemento)`,
    });
    await client.query(
      `UPDATE manos_sueldos SET estado = 'PAGADO', sueldo_usdt = $2, base_calculo_usdt = $3, ganancia_disponible_socios = $4,
         revision_base_usdt = NULL, revision_sueldo_usdt = NULL, movimiento_complemento_id = $5, observaciones = $6, updated_at = now()
       WHERE id = $1`,
      [
        id,
        nuevoSueldo,
        nuevaBase,
        round2(nuevaBase - nuevoSueldo),
        movId,
        agregarObservacion(s.observaciones, `${hoy}: sueldo ajustado a US$ ${nuevoSueldo.toFixed(2)}; complemento de US$ ${diferencia.toFixed(2)} pagado por Juan.`),
      ]
    );
    return leerSueldo(client, id);
  });
}
