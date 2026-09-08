import { pool, newId } from "../db/pool.js";

export type AccountType = "PREPAGO" | "WIN_LOSE" | "BANCADO" | "INTERNO" | "SUPERVISOR" | "UNION";

export async function upsertClub(name: string, unit = "USD", currentRate = 1) {
  const id = newId("club");
  const r = await pool.query(
    `INSERT INTO clubs (id, name, unit, current_rate) VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE SET unit=EXCLUDED.unit, current_rate=EXCLUDED.current_rate, updated_at=now()
     RETURNING *`,
    [id, name, unit, currentRate]
  );
  return r.rows[0];
}

/**
 * Configuración por defecto del club (punto 8 del documento de rediseño): lo que hereda
 * cualquier deal agente↔club que no defina su propio %. Solo actualiza los campos definidos.
 */
export async function updateClubConfig(
  id: string,
  fields: {
    name?: string;
    unit?: string;
    currentRate?: number;
    defaultRakebackPct?: number;
    defaultRebatePct?: number;
    rebateDestino?: "SALDO_OPERATIVO" | "RAKEBACK_SUPERVISOR";
    feePct?: number;
    platformPct?: number;
    unionPct?: number;
    active?: boolean;
    notes?: string | null;
  }
) {
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  const map: Record<string, any> = {
    name: fields.name,
    unit: fields.unit,
    current_rate: fields.currentRate,
    default_rakeback_pct: fields.defaultRakebackPct,
    default_rebate_pct: fields.defaultRebatePct,
    rebate_destino: fields.rebateDestino,
    fee_pct: fields.feePct,
    platform_pct: fields.platformPct,
    union_pct: fields.unionPct,
    active: fields.active,
    notes: fields.notes,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(val);
    }
  }
  if (sets.length === 0) {
    const r = await pool.query(`SELECT * FROM clubs WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
  sets.push(`updated_at = now()`);
  values.push(id);
  const r = await pool.query(`UPDATE clubs SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0] ?? null;
}

export async function upsertAgent(
  name: string,
  defaultSystem: "PREPAGO" | "WIN_LOSE",
  supervisor?: string | null,
  accountType?: AccountType
) {
  const id = newId("agent");
  const r = await pool.query(
    `INSERT INTO agents (id, name, default_system, supervisor, account_type)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (name) DO UPDATE SET default_system=EXCLUDED.default_system, supervisor=EXCLUDED.supervisor,
       account_type=EXCLUDED.account_type, updated_at=now()
     RETURNING *`,
    [id, name, defaultSystem, supervisor ?? null, accountType ?? defaultSystem]
  );
  return r.rows[0];
}

export async function getAgentByName(name: string) {
  const r = await pool.query(`SELECT * FROM agents WHERE name=$1`, [name]);
  return r.rows[0] ?? null;
}

export async function getClubByName(name: string) {
  const r = await pool.query(`SELECT * FROM clubs WHERE name=$1`, [name]);
  return r.rows[0] ?? null;
}

export async function addDeal(
  agentId: string,
  clubId: string,
  system: "PREPAGO" | "WIN_LOSE",
  rakebackPct: number,
  rebatePct: number,
  notes?: string
) {
  const id = newId("deal");
  await pool.query(
    `INSERT INTO agent_club_deals (id, agent_id, club_id, system, rakeback_pct, rebate_pct, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, agentId, clubId, system, rakebackPct, rebatePct, notes ?? null]
  );
  return id;
}

// Motor de reglas configurable (punto final del documento de rediseño): reemplaza el patrón
// "if (agente === 'Manzur') ..." por una tabla versionada. Igual que upsertDeal, cierra
// (valid_to = now()) la regla activa anterior para ese mismo agente+club antes de insertar la
// nueva vigente, así un cierre viejo siempre se puede recalcular con la regla que tenía en su
// momento. club_id NULL = regla global del agente (aplica en cualquier club que no tenga una
// regla más específica propia).
export async function addRuleVersion(agentId: string, ruleKey: string, params: object, description: string, clubId?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE rule_versions SET valid_to = now()
       WHERE agent_id = $1 AND valid_to IS NULL AND club_id IS NOT DISTINCT FROM $2`,
      [agentId, clubId ?? null]
    );
    const id = newId("rule");
    await client.query(
      `INSERT INTO rule_versions (id, agent_id, club_id, rule_key, params, description) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, agentId, clubId ?? null, ruleKey, JSON.stringify(params), description]
    );
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Termina (valid_to = now()) una regla especial vigente sin reemplazarla por otra: el agente
// vuelve a liquidarse con la fórmula genérica desde ahora. No borra la fila (queda en el
// historial para poder recalcular cierres viejos con la regla que tenían en su momento).
export async function endRuleVersion(ruleId: string) {
  const r = await pool.query(
    `UPDATE rule_versions SET valid_to = now() WHERE id = $1 AND valid_to IS NULL RETURNING *`,
    [ruleId]
  );
  return r.rows[0] ?? null;
}

export async function listRulesForAgent(agentId: string) {
  const r = await pool.query(
    `SELECT rv.*, c.name as club_name FROM rule_versions rv LEFT JOIN clubs c ON c.id = rv.club_id
     WHERE rv.agent_id = $1 ORDER BY rv.valid_from DESC`,
    [agentId]
  );
  return r.rows;
}

// Resuelve la regla especial vigente para un agente en un club a una fecha dada (por defecto
// ahora). Prioriza una regla específica del club por sobre una regla global del agente
// (club_id NULL) si ambas están vigentes al mismo tiempo.
export async function getActiveRule(agentId: string, clubId: string, atDate: string | Date = new Date()) {
  const r = await pool.query(
    `SELECT * FROM rule_versions
     WHERE agent_id = $1 AND (club_id = $2 OR club_id IS NULL)
       AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
     ORDER BY (club_id IS NULL) ASC, valid_from DESC
     LIMIT 1`,
    [agentId, clubId, atDate]
  );
  return r.rows[0] ?? null;
}

export async function setGuarantee(agentId: string, amount: number, consumed: number, notes?: string) {
  const id = newId("gua");
  await pool.query(
    `INSERT INTO guarantees (id, agent_id, amount, consumed, notes) VALUES ($1,$2,$3,$4,$5)`,
    [id, agentId, amount, consumed, notes ?? null]
  );
  return id;
}

/**
 * Edita un agente existente POR ID (a diferencia de upsertAgent, que "crea o pisa" por
 * nombre — sirve para altas, no para corregir un agente ya creado sin arriesgarse a
 * chocar contra otro nombre). Solo actualiza los campos que vienen definidos.
 */
export async function updateAgent(
  id: string,
  fields: {
    name?: string;
    defaultSystem?: "PREPAGO" | "WIN_LOSE";
    supervisor?: string | null;
    active?: boolean;
    accountType?: AccountType;
  }
) {
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (fields.name !== undefined) { sets.push(`name = $${i++}`); values.push(fields.name); }
  if (fields.defaultSystem !== undefined) { sets.push(`default_system = $${i++}`); values.push(fields.defaultSystem); }
  if (fields.supervisor !== undefined) { sets.push(`supervisor = $${i++}`); values.push(fields.supervisor); }
  if (fields.active !== undefined) { sets.push(`active = $${i++}`); values.push(fields.active); }
  if (fields.accountType !== undefined) { sets.push(`account_type = $${i++}`); values.push(fields.accountType); }
  if (sets.length === 0) {
    const r = await pool.query(`SELECT * FROM agents WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
  sets.push(`updated_at = now()`);
  values.push(id);
  const r = await pool.query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0] ?? null;
}

export async function listAgents() {
  const r = await pool.query(`SELECT * FROM agents WHERE active = true ORDER BY name`);
  return r.rows;
}

export async function listClubs() {
  const r = await pool.query(`SELECT * FROM clubs WHERE active = true ORDER BY name`);
  return r.rows;
}

/**
 * Crea una nueva versión de deal agente↔club: cierra (valid_to = now()) el deal activo
 * anterior para ese mismo agente+club si existe, e inserta el nuevo como vigente.
 * Así un cierre viejo siempre se puede recalcular con el % que tenía en su momento
 * (mismo principio que rule_versions).
 */
export async function upsertDeal(
  agentId: string,
  clubId: string,
  system: "PREPAGO" | "WIN_LOSE",
  rakebackPct: number,
  rebatePct: number,
  notes?: string
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_club_deals SET valid_to = now() WHERE agent_id=$1 AND club_id=$2 AND valid_to IS NULL`,
      [agentId, clubId]
    );
    const id = newId("deal");
    await client.query(
      `INSERT INTO agent_club_deals (id, agent_id, club_id, system, rakeback_pct, rebate_pct, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, agentId, clubId, system, rakebackPct, rebatePct, notes ?? null]
    );
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listDealsForAgent(agentId: string) {
  const r = await pool.query(
    `SELECT d.*, c.name as club_name FROM agent_club_deals d JOIN clubs c ON c.id = d.club_id
     WHERE d.agent_id = $1 AND d.valid_to IS NULL ORDER BY c.name`,
    [agentId]
  );
  return r.rows;
}
