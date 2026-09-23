// Stock físico por cuenta — equivalente al set de hojas "Stock por cuenta (fuente)" /
// "Stock consolidado" / "Obligación prepago" / "Deudas consolidadas" / "Resumen" de la planilla
// "Stock y deudas consolidados". A diferencia del ledger de agentes (inmutable, BIT-034), el
// conteo físico se edita/borra directo (pedido explícito del usuario, mismo criterio que
// partnerAccounts.ts) porque es un dato que se re-confirma todo el tiempo, no un movimiento de
// plata.
//
// Las 4 vistas de la planilla salen todas de acá, calculadas en vivo, agrupando por
// "grupo" = agents.supervisor si está cargado, si no el propio nombre del agente (mismo criterio
// que la columna "Agente / supervisor" de la planilla, ej. todos los subagentes de Uriel quedan
// bajo "Uriel"). Al calcularse siempre con GROUP BY en vez de pegar filas a mano, no se puede
// "olvidar" un agente como pasó en la planilla (Marcelo Mereles, daylight25, J Lenzo quedaron
// sin fila en "Deudas consolidadas" — ver análisis del 14/09/2026).
import { pool, newId } from "../db/pool.js";

export interface AccountStockInput {
  agentId: string;
  clubId: string;
  units: number;
  rate?: number | null; // null = sin tasa definida (no se puede convertir a USD todavía)
  excluded?: boolean;
  estado?: string;
  fuente?: string;
  observaciones?: string;
  confirmadoEn?: string; // YYYY-MM-DD
}

// Lista cruda, una fila por agente+club, con el sistema vigente (PREPAGO/WIN_LOSE) resuelto
// igual que resolverConfigVigente (deal vigente agente↔club, si no default_system del agente) —
// se resuelve en SQL para no tener que pegar N+1 consultas por fila.
async function listRaw() {
  const r = await pool.query(
    `SELECT
       s.*,
       a.name as agent_name,
       COALESCE(a.supervisor, a.name) as grupo,
       c.name as club_name,
       COALESCE(
         (SELECT d.system FROM agent_club_deals d
          WHERE d.agent_id = s.agent_id AND d.club_id = s.club_id AND d.valid_to IS NULL
          ORDER BY d.valid_from DESC LIMIT 1),
         a.default_system
       ) as system,
       CASE WHEN s.rate IS NOT NULL THEN s.units * s.rate ELSE NULL END as usd_ref
     FROM account_stock s
     JOIN agents a ON a.id = s.agent_id
     JOIN clubs c ON c.id = s.club_id
     ORDER BY grupo, c.name`
  );
  return r.rows;
}

export async function listAccountStock() {
  return listRaw();
}

export async function crearOEditarStock(input: AccountStockInput) {
  if (!(input.units >= 0) && !(input.units < 0)) throw new Error("Unidades inválidas.");
  const id = newId("stock");
  const r = await pool.query(
    `INSERT INTO account_stock (id, agent_id, club_id, units, rate, excluded, estado, fuente, observaciones, confirmado_en)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),$7,$8,$9,COALESCE($10, CURRENT_DATE))
     ON CONFLICT (agent_id, club_id) DO UPDATE SET
       units = EXCLUDED.units,
       rate = EXCLUDED.rate,
       excluded = EXCLUDED.excluded,
       estado = EXCLUDED.estado,
       fuente = EXCLUDED.fuente,
       observaciones = EXCLUDED.observaciones,
       confirmado_en = EXCLUDED.confirmado_en,
       updated_at = now()
     RETURNING *`,
    [
      id,
      input.agentId,
      input.clubId,
      input.units,
      input.rate ?? null,
      input.excluded ?? false,
      input.estado?.trim() || null,
      input.fuente?.trim() || null,
      input.observaciones?.trim() || null,
      input.confirmadoEn || null,
    ]
  );
  return r.rows[0];
}

export async function editarStock(id: string, input: Partial<AccountStockInput>) {
  const r = await pool.query(
    `UPDATE account_stock SET
       units = COALESCE($1, units),
       rate = CASE WHEN $2::boolean THEN $3 ELSE rate END,
       excluded = COALESCE($4, excluded),
       estado = CASE WHEN $5::boolean THEN $6 ELSE estado END,
       fuente = CASE WHEN $7::boolean THEN $8 ELSE fuente END,
       observaciones = CASE WHEN $9::boolean THEN $10 ELSE observaciones END,
       confirmado_en = COALESCE($11, confirmado_en),
       updated_at = now()
     WHERE id = $12 RETURNING *`,
    [
      input.units ?? null,
      input.rate !== undefined,
      input.rate ?? null,
      input.excluded ?? null,
      input.estado !== undefined,
      input.estado?.trim() || null,
      input.fuente !== undefined,
      input.fuente?.trim() || null,
      input.observaciones !== undefined,
      input.observaciones?.trim() || null,
      input.confirmadoEn || null,
      id,
    ]
  );
  if (!r.rows[0]) throw new Error("No se encontró ese registro de stock.");
  return r.rows[0];
}

// Borrado real — control 100% pedido explícitamente por el usuario para este módulo.
export async function eliminarStock(id: string) {
  const r = await pool.query(`DELETE FROM account_stock WHERE id = $1 RETURNING id`, [id]);
  if (r.rowCount === 0) throw new Error("No se encontró ese registro de stock.");
}

// "Stock consolidado" — agrupado por grupo (supervisor o el propio agente) + club, excluyendo
// las cuentas espejo (excluded=true) para no duplicar plata.
// Agrupa por grupo+club+SISTEMA (24/09/2026, pedido de Leo: "necesito que separemos los
// win/lose de los prepagos" -- antes una cuenta WIN_LOSE y una PREPAGO del mismo grupo+club
// quedaban sumadas juntas en un solo total, cosa que no tiene sentido: son dos naturalezas de
// stock distintas -- el prepago es pasivo propio (ver getObligacionPrepago), el win/lose no.
export async function getStockConsolidado() {
  const rows = await listRaw();
  const map = new Map<
    string,
    { grupo: string; club_id: string; club_name: string; system: string; unidades: number; usd: number; conTasa: number; cuentas: string[] }
  >();
  for (const r of rows) {
    if (r.excluded) continue;
    const key = `${r.grupo}::${r.club_id}::${r.system}`;
    if (!map.has(key)) {
      map.set(key, { grupo: r.grupo, club_id: r.club_id, club_name: r.club_name, system: r.system, unidades: 0, usd: 0, conTasa: 0, cuentas: [] });
    }
    const bucket = map.get(key)!;
    bucket.unidades += Number(r.units);
    if (r.usd_ref !== null) {
      bucket.usd += Number(r.usd_ref);
      bucket.conTasa += 1;
    }
    bucket.cuentas.push(r.agent_name);
  }
  return [...map.values()]
    .map((b) => ({ grupo: b.grupo, club_id: b.club_id, club_name: b.club_name, system: b.system, unidades: b.unidades, cuentas: b.cuentas, usd: b.conTasa > 0 ? b.usd : null }))
    .sort((a, b) => a.grupo.localeCompare(b.grupo) || a.club_name.localeCompare(b.club_name) || a.system.localeCompare(b.system));
}

// "Obligación prepago" — cuentas no excluidas cuyo sistema vigente es PREPAGO, con su
// equivalente USD (cuando la tasa está definida). Es el pasivo contingente: no es deuda
// exigible hoy, se vuelve exigible recién si se descarga y no se paga.
export async function getObligacionPrepago() {
  const rows = await listRaw();
  return rows.filter((r) => !r.excluded && r.system === "PREPAGO");
}

// "Resumen": stock general por club, separado por sistema (24/09/2026, pedido de Leo: "tambien
// necesito que los separes en resumen" -- misma mezcla que tenía Stock consolidado: una cuenta
// WIN_LOSE y una PREPAGO del mismo club quedaban sumadas juntas en un solo total) + el total de
// obligación prepago.
export async function getResumenStock() {
  const rows = await listRaw();
  const porClub = new Map<string, { club_id: string; club_name: string; system: string; cuentas: number; unidades: number; usd: number; conTasa: number }>();
  for (const r of rows) {
    if (r.excluded) continue;
    const key = `${r.club_id}::${r.system}`;
    if (!porClub.has(key)) {
      porClub.set(key, { club_id: r.club_id, club_name: r.club_name, system: r.system, cuentas: 0, unidades: 0, usd: 0, conTasa: 0 });
    }
    const b = porClub.get(key)!;
    b.cuentas += 1;
    b.unidades += Number(r.units);
    if (r.usd_ref !== null) {
      b.usd += Number(r.usd_ref);
      b.conTasa += 1;
    }
  }
  const prepago = rows.filter((r) => !r.excluded && r.system === "PREPAGO");
  const totalPrepagoUsd = prepago.reduce((acc, r) => acc + (r.usd_ref !== null ? Number(r.usd_ref) : 0), 0);
  return {
    porClub: [...porClub.values()]
      .map((b) => ({ club_id: b.club_id, club_name: b.club_name, system: b.system, cuentas: b.cuentas, unidades: b.unidades, usd: b.conTasa > 0 ? b.usd : null }))
      .sort((a, b) => a.club_name.localeCompare(b.club_name) || a.system.localeCompare(b.system)),
    totalPrepagoUsd,
  };
}

// "Deudas consolidadas" — cruza, por grupo (supervisor o agente), el saldo financiero
// (balances), garantías y adelantos vigentes YA existentes en el sistema, más el stock prepago
// de este módulo. Esto es lo que en la planilla se arma pegando filas a mano por agente — acá
// sale de un GROUP BY, así que nunca le puede faltar un agente con stock/deuda como le pasó a
// Marcelo Mereles/daylight25/J Lenzo en la planilla del 14/09.
export async function getDeudasConsolidadas() {
  const agentesRes = await pool.query(`SELECT id, name, COALESCE(supervisor, name) as grupo FROM agents WHERE active = true`);
  const grupoDeAgente = new Map<string, string>();
  for (const a of agentesRes.rows) grupoDeAgente.set(a.id, a.grupo);

  const acc = new Map<string, { grupo: string; nosDebe: number; debemos: number; garantia: number; adelantos: number; stockPrepago: number }>();
  function bucket(grupo: string) {
    if (!acc.has(grupo)) acc.set(grupo, { grupo, nosDebe: 0, debemos: 0, garantia: 0, adelantos: 0, stockPrepago: 0 });
    return acc.get(grupo)!;
  }

  const balancesRes = await pool.query(
    `SELECT agent_id, amount FROM balances WHERE ABS(amount) >= 0.01`
  );
  for (const b of balancesRes.rows) {
    const grupo = grupoDeAgente.get(b.agent_id);
    if (!grupo) continue; // agente inactivo/no encontrado — se omite, no se inventa grupo
    const amt = Number(b.amount);
    const bk = bucket(grupo);
    if (amt > 0) bk.debemos += amt;
    else bk.nosDebe += -amt;
  }

  const garantiasRes = await pool.query(`SELECT agent_id, amount, consumed FROM guarantees WHERE active = true`);
  for (const g of garantiasRes.rows) {
    const grupo = grupoDeAgente.get(g.agent_id);
    if (!grupo) continue;
    bucket(grupo).garantia += Number(g.amount) - Number(g.consumed);
  }

  const adelantosRes = await pool.query(`SELECT agent_id, amount, consumed FROM rakeback_advances WHERE active = true`);
  for (const ad of adelantosRes.rows) {
    const grupo = grupoDeAgente.get(ad.agent_id);
    if (!grupo) continue;
    bucket(grupo).adelantos += Number(ad.amount) - Number(ad.consumed);
  }

  const prepago = await getObligacionPrepago();
  for (const p of prepago) {
    if (p.usd_ref === null) continue;
    bucket(p.grupo).stockPrepago += Number(p.usd_ref);
  }

  const filas = [...acc.values()]
    .map((b) => ({ ...b, neto: b.nosDebe - b.debemos }))
    .filter((b) => b.nosDebe >= 0.01 || b.debemos >= 0.01 || b.garantia >= 0.01 || b.adelantos >= 0.01 || b.stockPrepago >= 0.01)
    .sort((a, b) => b.neto - a.neto);

  const totales = filas.reduce(
    (t, f) => ({
      nosDebe: t.nosDebe + f.nosDebe,
      debemos: t.debemos + f.debemos,
      garantia: t.garantia + f.garantia,
      adelantos: t.adelantos + f.adelantos,
      stockPrepago: t.stockPrepago + f.stockPrepago,
    }),
    { nosDebe: 0, debemos: 0, garantia: 0, adelantos: 0, stockPrepago: 0 }
  );

  return { filas, totales: { ...totales, neto: totales.nosDebe - totales.debemos } };
}
