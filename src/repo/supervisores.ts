// Cuentas consolidadas para supervisores (30/09/2026, pedido de Leo: "Edwar es un super
// agente, todo lo que pase con sus agentes va todo al mismo lugar"). Sistema DELIBERADAMENTE
// aislado de agents/balances/weekly_closings/rakeback_pendiente/closings.ts -- mismo criterio
// de separación que se usó para proveedores.ts, para no arriesgar el motor de cierres de todos
// los demás agentes que NO son cuenta consolidada. Ver src/db/schema.sql para el detalle de
// cada tabla.
import { pool, newId } from "../db/pool.js";
import type { PoolClient } from "pg";
import { registrarAjusteTesoreria, revertirAjusteTesoreria } from "./treasury.js";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Trae (con lock FOR UPDATE) la cuenta consolidada de un supervisor, creándola en 0/0 si es la
// primera vez que se le registra algo (el alta "de verdad", con el saldo histórico migrado, la
// hace migrarSaldoHistoricoSupervisor -- si ese paso corre antes de cualquier movimiento manual,
// esta función simplemente encuentra la fila ya creada y no la pisa).
async function getCuentaParaUpdate(client: PoolClient, supervisorAgentId: string) {
  const existing = await client.query(
    `SELECT * FROM supervisor_cuentas WHERE supervisor_agent_id = $1 FOR UPDATE`,
    [supervisorAgentId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const r = await client.query(
    `INSERT INTO supervisor_cuentas (id, supervisor_agent_id, fichas_reales, cuenta_corriente) VALUES ($1,$2,0,0) RETURNING *`,
    [newId("svcta"), supervisorAgentId]
  );
  return r.rows[0];
}

export async function listSupervisoresConsolidados() {
  const r = await pool.query(
    `SELECT a.*, COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente,
            sc.updated_at as cuenta_updated_at
     FROM agents a
     LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
     WHERE a.usa_cuenta_consolidada = true
     ORDER BY a.name`
  );
  return r.rows;
}

export async function getSupervisorConCuenta(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT a.*, COALESCE(sc.fichas_reales, 0) as fichas_reales, COALESCE(sc.cuenta_corriente, 0) as cuenta_corriente,
            sc.updated_at as cuenta_updated_at
     FROM agents a LEFT JOIN supervisor_cuentas sc ON sc.supervisor_agent_id = a.id
     WHERE a.id = $1`,
    [supervisorAgentId]
  );
  return r.rows[0] ?? null;
}

// Agentes cuyo campo "Supervisor" apunta a este (resuelto por nombre, mismo criterio que ya
// usa rebate_destino=RAKEBACK_SUPERVISOR) -- nunca tienen saldo/cierre propio mientras la
// cuenta consolidada esté activa; esto es SOLO para mostrar quiénes son (lectura/auditoría).
export async function listSubordinados(supervisorAgentId: string) {
  const sup = await pool.query(`SELECT name FROM agents WHERE id = $1`, [supervisorAgentId]);
  if (!sup.rows[0]) return [];
  const r = await pool.query(`SELECT * FROM agents WHERE supervisor = $1 ORDER BY name`, [sup.rows[0].name]);
  return r.rows;
}

export interface MovimientoSupervisorInput {
  supervisorAgentId: string;
  clubId: string;
  /** Informativo únicamente (gateado por agents.exigir_agente_en_movimientos del supervisor) --
   * JAMÁS genera saldo propio para este agente. */
  agentId?: string | null;
  type: "CARGA" | "DESCARGA" | "AJUSTE";
  /** CARGA/DESCARGA: siempre > 0 (el signo lo define el type, ver reclasificación de Leo).
   * AJUSTE: puede ser positivo o negativo, aplicado directo al campo elegido en campoAjuste. */
  amount: number;
  /** Solo para type AJUSTE: a qué lado de la cuenta pega. */
  campoAjuste?: "FICHAS" | "CUENTA_CORRIENTE";
  /** Si además hubo una transferencia real de USDT (no solo reclasificación interna) -- ver
   * Wallet Manos, pedido explícito de Leo: nunca tocarlo salvo que esto sea true. */
  usdtReal?: boolean;
  notes?: string | null;
  createdBy?: string | null;
}

// Carga: fichas_reales += importe, cuenta_corriente -= importe. Descarga (corregido 30/09/2026,
// Leo: "primero se descuenta de su cuenta corriente y luego de las fichas reales" -- NO es la
// reversa simétrica de una carga): come primero de cuenta_corriente hasta un piso de 0 (si ya
// estaba en negativo, no la empeora -- todo pasa directo a fichas) y el resto lo descuenta de
// fichas_reales, que si no alcanza queda en negativo (confirmado por Leo: representa deuda,
// mismo criterio permisivo que ya tienen los balances de agentes comunes). Ajuste: mueve un solo
// lado a mano, con el signo que se indique (para correcciones puntuales que no son ni una carga
// ni una descarga real) y NUNCA mueve Wallet Manos, sin importar qué mande el frontend (mismo
// criterio que ya usa AJUSTE/SIN_TESORERIA en repo/ledger.ts). Nunca toca balances/
// ledger_movements de ningún agente.
export async function registrarMovimientoSupervisor(input: MovimientoSupervisorInput) {
  const sup = await pool.query(`SELECT * FROM agents WHERE id = $1`, [input.supervisorAgentId]);
  if (!sup.rows[0]) throw new Error("Supervisor no encontrado.");
  if (!sup.rows[0].usa_cuenta_consolidada) throw new Error("Este agente no tiene la cuenta consolidada activada.");
  if (sup.rows[0].exigir_agente_en_movimientos && !input.agentId) {
    throw new Error("Este supervisor exige indicar el agente de origen del movimiento.");
  }

  let amount = 0;
  if (input.type === "CARGA" || input.type === "DESCARGA") {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("El importe debe ser mayor a 0.");
    amount = round2(input.amount);
  } else if (input.type === "AJUSTE") {
    if (!Number.isFinite(input.amount) || input.amount === 0) throw new Error("El importe del ajuste no puede ser 0.");
    if (!input.campoAjuste) throw new Error("El ajuste necesita indicar a qué campo se aplica (fichas o cuenta corriente).");
  } else {
    throw new Error("Tipo de movimiento inválido.");
  }

  // Forzado acá (único punto donde se decide si se abre un asiento de tesorería), no confía en
  // lo que mande el frontend.
  const usdtReal = input.type !== "AJUSTE" && !!input.usdtReal;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cuenta = await getCuentaParaUpdate(client, input.supervisorAgentId);
    const fichasAnterior = Number(cuenta.fichas_reales);
    const ccAnterior = Number(cuenta.cuenta_corriente);

    let fichasDelta = 0;
    let ccDelta = 0;
    if (input.type === "CARGA") {
      fichasDelta = amount;
      ccDelta = -amount;
    } else if (input.type === "DESCARGA") {
      const montoDeCC = Math.min(amount, Math.max(ccAnterior, 0));
      const restante = round2(amount - montoDeCC);
      ccDelta = round2(-montoDeCC);
      fichasDelta = round2(-restante);
    } else {
      const ajusteAmount = round2(input.amount);
      if (input.campoAjuste === "FICHAS") fichasDelta = ajusteAmount;
      else ccDelta = ajusteAmount;
    }

    // Transferencia real de USDT además de la reclasificación interna de arriba: Carga = nos
    // entró plata de verdad (INGRESO a Wallet Manos), Descarga = le mandamos plata de verdad
    // (EGRESO). No es atómico con esta transacción -- mismo criterio ya usado en
    // pagarComisionesReferido/pagarCierreBancado (repo/supervisorReferidos.ts,
    // repo/bancados.ts): si algo falla después, el asiento de Wallet queda igual, auditable, y
    // se puede revertir a mano.
    let treasuryAdjustmentId: string | null = null;
    if (usdtReal) {
      const direction = input.type === "CARGA" ? "INGRESO" : "EGRESO";
      const { id: adjId } = await registrarAjusteTesoreria({
        ledger: "WALLET_MANOS",
        direction,
        amount,
        reason: `Supervisor ${sup.rows[0].name} — ${input.type.toLowerCase()} US$ ${amount.toFixed(2)}`,
        createdBy: input.createdBy ?? null,
      });
      treasuryAdjustmentId = adjId;
    }

    const fichasNuevo = round2(fichasAnterior + fichasDelta);
    const ccNuevo = round2(ccAnterior + ccDelta);

    const id = newId("svmov");
    await client.query(
      `INSERT INTO supervisor_movimientos
        (id, supervisor_agent_id, club_id, agent_id, type, amount, fichas_reales_delta, cuenta_corriente_delta,
         usdt_real, treasury_adjustment_id, saldo_anterior_fichas, saldo_anterior_cc, saldo_nuevo_fichas, saldo_nuevo_cc, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id, input.supervisorAgentId, input.clubId, input.agentId ?? null, input.type, round2(input.amount),
        fichasDelta, ccDelta, usdtReal, treasuryAdjustmentId, fichasAnterior, ccAnterior, fichasNuevo, ccNuevo,
        input.notes ?? null, input.createdBy ?? null,
      ]
    );
    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasNuevo, ccNuevo, cuenta.id]
    );
    await client.query("COMMIT");
    return { id, fichasAnterior, ccAnterior, fichasNuevo, ccNuevo, treasuryAdjustmentId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMovimientosSupervisor(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT sm.*, c.name as club_name, a.name as agent_name
     FROM supervisor_movimientos sm
     JOIN clubs c ON c.id = sm.club_id
     LEFT JOIN agents a ON a.id = sm.agent_id
     WHERE sm.supervisor_agent_id = $1
     ORDER BY sm.occurred_at DESC`,
    [supervisorAgentId]
  );
  return r.rows;
}

// Revierte un movimiento manual cargado por error -- LEDGER INMUTABLE, no lo borra: aplica el
// delta contrario sobre la cuenta y marca REVERTIDO (mismo criterio que revertirPagoProveedor).
export async function revertirMovimientoSupervisor(movimientoId: string) {
  const client = await pool.connect();
  let treasuryAdjustmentId: string | null = null;
  try {
    await client.query("BEGIN");
    const movRes = await client.query(`SELECT * FROM supervisor_movimientos WHERE id = $1 FOR UPDATE`, [movimientoId]);
    const mov = movRes.rows[0];
    if (!mov) throw new Error("Movimiento no encontrado.");
    if (mov.status === "REVERTIDO") throw new Error("Este movimiento ya estaba revertido.");

    const cuenta = await getCuentaParaUpdate(client, mov.supervisor_agent_id);
    const fichasAnterior = Number(cuenta.fichas_reales);
    const ccAnterior = Number(cuenta.cuenta_corriente);
    const fichasNuevo = round2(fichasAnterior - Number(mov.fichas_reales_delta));
    const ccNuevo = round2(ccAnterior - Number(mov.cuenta_corriente_delta));

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasNuevo, ccNuevo, cuenta.id]
    );
    await client.query(`UPDATE supervisor_movimientos SET status = 'REVERTIDO' WHERE id = $1`, [movimientoId]);
    await client.query("COMMIT");
    treasuryAdjustmentId = mov.treasury_adjustment_id ?? null;
    return { id: movimientoId, fichasNuevo, ccNuevo };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    // Si el movimiento había tocado Wallet Manos de verdad (usdt_real), revierte también ese
    // asiento -- no es atómico con lo de arriba (mismo criterio explicado en
    // registrarMovimientoSupervisor); revertirAjusteTesoreria es segura de llamar dos veces:
    // si ya estuviera revertido tira error en vez de duplicar la reversa.
    if (treasuryAdjustmentId) {
      await revertirAjusteTesoreria(treasuryAdjustmentId, `Reversión de movimiento de supervisor ${movimientoId}`);
    }
  }
}

// Corrección histórica (una sola vez, por supervisor): cuando se prende usa_cuenta_consolidada
// para un supervisor que YA tenía agentes operando con saldo propio (caso Edwar, confirmado por
// Leo), esto mueve ese saldo acumulado a la cuenta nueva, dejando registro línea por línea en
// supervisor_migracion_historica -- nunca en silencio. NO toca balances/rakeback_pendiente de
// los agentes de origen (quedan tal cual quedaron, como registro histórico de lo que tenían --
// ver nota en el llamado: es el propio Leo quien confirma los montos antes de correr esto,
// según el diagnóstico de diagnosticoSaldoSupervisor.ts).
export interface LineaMigracionHistorica {
  agentId: string;
  clubId?: string | null;
  fichasMigradas: number;
  pendienteMigrado: number;
  notes?: string | null;
}
export async function migrarSaldoHistoricoSupervisor(
  supervisorAgentId: string,
  lineas: LineaMigracionHistorica[],
  createdBy?: string | null
) {
  if (lineas.length === 0) throw new Error("No hay líneas para migrar.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cuenta = await getCuentaParaUpdate(client, supervisorAgentId);
    let fichasTotal = Number(cuenta.fichas_reales);
    let ccTotal = Number(cuenta.cuenta_corriente);

    for (const l of lineas) {
      fichasTotal = round2(fichasTotal + l.fichasMigradas);
      ccTotal = round2(ccTotal + l.pendienteMigrado);
      await client.query(
        `INSERT INTO supervisor_migracion_historica
          (id, supervisor_agent_id, agent_id, club_id, fichas_migradas, pendiente_migrado, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId("svmig"), supervisorAgentId, l.agentId, l.clubId ?? null, l.fichasMigradas, l.pendienteMigrado, l.notes ?? null, createdBy ?? null]
      );
    }

    await client.query(
      `UPDATE supervisor_cuentas SET fichas_reales = $1, cuenta_corriente = $2, updated_at = now() WHERE id = $3`,
      [fichasTotal, ccTotal, cuenta.id]
    );
    await client.query("COMMIT");
    return { fichasTotal, ccTotal };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listMigracionHistorica(supervisorAgentId: string) {
  const r = await pool.query(
    `SELECT smh.*, a.name as agent_name, c.name as club_name
     FROM supervisor_migracion_historica smh
     JOIN agents a ON a.id = smh.agent_id
     LEFT JOIN clubs c ON c.id = smh.club_id
     WHERE smh.supervisor_agent_id = $1
     ORDER BY smh.created_at`,
    [supervisorAgentId]
  );
  return r.rows;
}
