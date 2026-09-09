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
    /** Nombre de hoja (.xlsx) que el importador de cierres asocia a este club — ej. "Fenix",
     * "tb". Es solo una sugerencia para precargar el selector, nunca un requisito. */
    importSource?: string | null;
    /** Plataforma/red de origen para el importador (ej. "SUPREMA") — filtra qué clubes
     * aparecen como opción al elegir club para una hoja de ESE formato de archivo. NULL =
     * este club no se carga por importador de archivo. */
    importPlatform?: string | null;
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
    import_source: fields.importSource,
    import_platform: fields.importPlatform,
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

// Vista global (todas las reglas de todos los agentes en un solo listado) — para no tener que
// entrar agente por agente a buscar cuáles tienen reglas especiales activas.
export async function listAllRules() {
  const r = await pool.query(
    `SELECT rv.*, a.name as agent_name, c.name as club_name
     FROM rule_versions rv
     JOIN agents a ON a.id = rv.agent_id
     LEFT JOIN clubs c ON c.id = rv.club_id
     ORDER BY (rv.valid_to IS NULL) DESC, rv.valid_from DESC`
  );
  return r.rows;
}

// Árbol Plataforma -> Club -> Agentes: para cada club activo, los agentes que YA tienen al
// menos un jugador cargado ahí (vía import o carga manual), con su % vigente (deal propio o
// default del club, mismo resolverConfigVigente que usa el importador — nunca inventa un número
// acá tampoco). Cada club lleva su import_platform (SUPREMA/GG/XPOKER/null) para que el frontend
// agrupe primero por plataforma — un mismo club real puede tener actividad en más de una
// plataforma a la vez (ver nota de negocio: "Teamback puede estar en Suprema, GG y X-Poker").
// Los jugadores de cada agente se piden aparte (getJugadoresDeAgenteEnClub) para no traer una
// lista gigante de una si nadie la va a abrir.
export async function getArbolClubes() {
  const clubesRes = await pool.query(
    `SELECT id, name, import_platform FROM clubs WHERE active = true ORDER BY name`
  );
  const arbol = [];
  for (const club of clubesRes.rows) {
    const agentesRes = await pool.query(
      `SELECT p.agent_id, a.name as agent_name, COUNT(*) as jugadores
       FROM players p JOIN agents a ON a.id = p.agent_id
       WHERE p.club_id = $1 AND p.agent_id IS NOT NULL
       GROUP BY p.agent_id, a.name
       ORDER BY a.name`,
      [club.id]
    );
    const agentes = [];
    for (const ag of agentesRes.rows) {
      const config = await resolverConfigVigente(ag.agent_id, club.id);
      agentes.push({
        agentId: ag.agent_id,
        agentName: ag.agent_name,
        jugadores: Number(ag.jugadores),
        system: config.system,
        rakebackPct: config.rakebackPct,
        rebatePct: config.rebatePct,
        configSource: config.source,
      });
    }
    arbol.push({ clubId: club.id, clubName: club.name, platform: club.import_platform ?? null, agentes });
  }
  return arbol;
}

export async function getJugadoresDeAgenteEnClub(clubId: string, agentId: string) {
  const r = await pool.query(
    `SELECT id, external_id, display_name FROM players WHERE club_id = $1 AND agent_id = $2 ORDER BY display_name`,
    [clubId, agentId]
  );
  return r.rows;
}

// Borra una fila de "players" (catálogo/roster: club+agente asignado a un jugador). Esto NUNCA
// toca el ledger: weekly_closings y ledger_movements se referencian por agent_id+club_id, no por
// player_id, así que borrar acá no revierte ni afecta ningún cierre ya aplicado (ver schema.sql).
// Se usa para limpiar jugadores que quedaron mal asignados a un club por error de carga, para
// después recargarlos manualmente en el club correcto.
export async function eliminarJugador(playerId: string) {
  const r = await pool.query(`DELETE FROM players WHERE id = $1 RETURNING id`, [playerId]);
  return r.rowCount ? r.rowCount > 0 : false;
}

// Mueve TODOS los jugadores de un agente en un club a otro club de una — para el caso típico de
// contaminación (un agente quedó entero bajo el club equivocado por el bug viejo de
// import_source). Igual que eliminarJugador, esto es un cambio de catálogo puro: no toca
// weekly_closings/ledger_movements. Fila por fila (no un UPDATE masivo) porque el destino puede
// ya tener una fila con el mismo external_id (UNIQUE(club_id, external_id)) — en ese caso esa
// fila puntual se salta en vez de romper todo el movimiento, y se informa cuántas se saltearon
// para que el usuario las revise a mano (probablemente ya está bien cargada del lado correcto).
export async function moverAgenteDeClub(fromClubId: string, agentId: string, toClubId: string) {
  const jugadores = await pool.query(
    `SELECT id FROM players WHERE club_id = $1 AND agent_id = $2`,
    [fromClubId, agentId]
  );
  let movidos = 0;
  let saltados = 0;
  for (const j of jugadores.rows) {
    try {
      await pool.query(`UPDATE players SET club_id = $1 WHERE id = $2`, [toClubId, j.id]);
      movidos++;
    } catch (err: any) {
      if (err.code === "23505") saltados++; // ya existe ese external_id en el club destino
      else throw err;
    }
  }
  return { movidos, saltados, total: jugadores.rows.length };
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
    /** ID del agente en la plataforma de origen (ej. "Agent ID" del reporte Suprema). Permite
     * que el importador lo reconozca aunque el nombre cambie o venga con espacios distintos. */
    externalId?: string | null;
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
  if (fields.externalId !== undefined) { sets.push(`external_id = $${i++}`); values.push(fields.externalId); }
  if (sets.length === 0) {
    const r = await pool.query(`SELECT * FROM agents WHERE id = $1`, [id]);
    return r.rows[0] ?? null;
  }
  sets.push(`updated_at = now()`);
  values.push(id);
  const r = await pool.query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0] ?? null;
}

// `includeInactive`: "Dar de baja" nunca borra nada, pero listAgents() solo devolvía activos —
// una vez dado de baja, el agente desaparecía de la lista sin ninguna forma de volver a verlo,
// reactivarlo o (si era un duplicado de prueba) borrarlo de verdad. Con este flag el frontend
// puede pedir "también los dados de baja" y mostrarlos aparte (atenuados, con Reactivar/Eliminar).
export async function listAgents(includeInactive = false) {
  const r = await pool.query(
    includeInactive
      ? `SELECT * FROM agents ORDER BY active DESC, name`
      : `SELECT * FROM agents WHERE active = true ORDER BY name`
  );
  return r.rows;
}

/**
 * Borrado real de un agente (a diferencia de "dar de baja", que solo lo desactiva). Mismo
 * espíritu que eliminarCierreSemanalDefinitivo (closings.ts): pensado para limpiar agentes
 * creados por error o por el auto-create del importador (BIT-nueva) que nunca tuvieron
 * movimiento real — NUNCA para un agente con historial de plata real, aunque esté dado de baja.
 * Por eso se rechaza en bloque si tiene CUALQUIER rastro en otra tabla, en vez de intentar
 * despegarlo prolijamente — un agente con historial real no se borra, se da de baja.
 */
export async function eliminarAgenteDefinitivo(agentId: string) {
  const agentRes = await pool.query(`SELECT id, name FROM agents WHERE id = $1`, [agentId]);
  const agent = agentRes.rows[0];
  if (!agent) return { found: false as const };

  const checks: { label: string; sql: string; params: any[] }[] = [
    { label: "jugadores asignados", sql: `SELECT 1 FROM players WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "movimientos en el ledger", sql: `SELECT 1 FROM ledger_movements WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "cierres semanales", sql: `SELECT 1 FROM weekly_closings WHERE agent_id = $1 OR supervisor_agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "deals (% rakeback/rebate) cargados", sql: `SELECT 1 FROM agent_club_deals WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "reglas especiales", sql: `SELECT 1 FROM rule_versions WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "garantías", sql: `SELECT 1 FROM guarantees WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "movimientos de garantía", sql: `SELECT 1 FROM guarantee_movements WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "deuda de bancado", sql: `SELECT 1 FROM bancado_debts WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "memoria de Rodeo", sql: `SELECT 1 FROM rodeo_agent_memory WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "saldo en balances", sql: `SELECT 1 FROM balances WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "asignaciones manuales de jugador (overrides)", sql: `SELECT 1 FROM player_agent_overrides WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "usuarios de login vinculados", sql: `SELECT 1 FROM agent_users WHERE agent_id = $1 LIMIT 1`, params: [agentId] },
    { label: "otro agente lo tiene cargado como supervisor", sql: `SELECT 1 FROM agents WHERE supervisor = $1 AND id <> $2 LIMIT 1`, params: [agent.name, agentId] },
  ];
  for (const check of checks) {
    const r = await pool.query(check.sql, check.params);
    if (r.rows.length > 0) {
      throw new Error(
        `No se puede borrar "${agent.name}": todavía tiene ${check.label}. Si es un agente real, dalo de baja en vez de borrarlo — el borrado definitivo es solo para agentes de prueba/duplicados sin ningún rastro.`
      );
    }
  }

  await pool.query(`DELETE FROM agents WHERE id = $1`, [agentId]);
  return { found: true as const, id: agentId };
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

/**
 * Resuelve qué % de rakeback/rebate y qué sistema le corresponde a un agente en un club,
 * a una fecha dada — usado por el importador (BIT-nueva: "usar la configuración del sistema,
 * no que el archivo traiga su propio %"). Prioridad: deal vigente agente↔club > default del
 * club + sistema por defecto del agente. Nunca inventa un % — si no hay deal ni default
 * configurado, devuelve 0 y lo marca (source) para que la UI pueda avisar.
 */
export async function resolverConfigVigente(agentId: string, clubId: string, atDate: string | Date = new Date()) {
  const dealRes = await pool.query(
    `SELECT system, rakeback_pct, rebate_pct FROM agent_club_deals
     WHERE agent_id = $1 AND club_id = $2 AND valid_from <= $3 AND (valid_to IS NULL OR valid_to > $3)
     ORDER BY valid_from DESC LIMIT 1`,
    [agentId, clubId, atDate]
  );
  if (dealRes.rows[0]) {
    return {
      system: dealRes.rows[0].system as "PREPAGO" | "WIN_LOSE",
      rakebackPct: Number(dealRes.rows[0].rakeback_pct),
      rebatePct: Number(dealRes.rows[0].rebate_pct),
      source: "deal" as const,
    };
  }
  const clubRes = await pool.query(`SELECT default_rakeback_pct, default_rebate_pct FROM clubs WHERE id = $1`, [clubId]);
  const agentRes = await pool.query(`SELECT default_system FROM agents WHERE id = $1`, [agentId]);
  return {
    system: (agentRes.rows[0]?.default_system as "PREPAGO" | "WIN_LOSE") ?? "WIN_LOSE",
    rakebackPct: Number(clubRes.rows[0]?.default_rakeback_pct ?? 0),
    rebatePct: Number(clubRes.rows[0]?.default_rebate_pct ?? 0),
    source: "default_club" as const,
  };
}

export async function listDealsForAgent(agentId: string) {
  const r = await pool.query(
    `SELECT d.*, c.name as club_name FROM agent_club_deals d JOIN clubs c ON c.id = d.club_id
     WHERE d.agent_id = $1 AND d.valid_to IS NULL ORDER BY c.name`,
    [agentId]
  );
  return r.rows;
}
