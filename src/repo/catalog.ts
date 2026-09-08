import { pool, newId } from "../db/pool.js";

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

export async function upsertAgent(name: string, defaultSystem: "PREPAGO" | "WIN_LOSE", supervisor?: string | null) {
  const id = newId("agent");
  const r = await pool.query(
    `INSERT INTO agents (id, name, default_system, supervisor) VALUES ($1,$2,$3,$4)
     ON CONFLICT (name) DO UPDATE SET default_system=EXCLUDED.default_system, supervisor=EXCLUDED.supervisor, updated_at=now()
     RETURNING *`,
    [id, name, defaultSystem, supervisor ?? null]
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

export async function addRuleVersion(agentId: string, ruleKey: string, params: object, description: string, clubId?: string | null) {
  const id = newId("rule");
  await pool.query(
    `INSERT INTO rule_versions (id, agent_id, club_id, rule_key, params, description) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, agentId, clubId ?? null, ruleKey, JSON.stringify(params), description]
  );
  return id;
}

export async function setGuarantee(agentId: string, amount: number, consumed: number, notes?: string) {
  const id = newId("gua");
  await pool.query(
    `INSERT INTO guarantees (id, agent_id, amount, consumed, notes) VALUES ($1,$2,$3,$4,$5)`,
    [id, agentId, amount, consumed, notes ?? null]
  );
  return id;
}

export async function listAgents() {
  const r = await pool.query(`SELECT * FROM agents WHERE active = true ORDER BY name`);
  return r.rows;
}

export async function listClubs() {
  const r = await pool.query(`SELECT * FROM clubs WHERE active = true ORDER BY name`);
  return r.rows;
}

export async function listDealsForAgent(agentId: string) {
  const r = await pool.query(
    `SELECT d.*, c.name as club_name FROM agent_club_deals d JOIN clubs c ON c.id = d.club_id
     WHERE d.agent_id = $1 AND d.valid_to IS NULL ORDER BY c.name`,
    [agentId]
  );
  return r.rows;
}
