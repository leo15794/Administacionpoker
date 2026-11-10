// Subagentes de un agente (10/11/2026, pedido de Leo, mockup 87): "que los agentes puedan crear subagentes, como hicimos con los
// supervisores; los subagentes están dentro de los agentes y ellos mismos les tienen que poder crear el usuario".
//
// De dónde salen: los archivos semanales de Suprema ("Sub Agent ID/Name") y de TeamBack GG (columna "Agent" debajo del Super Agent)
// traen a qué subagente pertenece cada jugador. Al importar, ese dato se guarda en el jugador (players.club_subagente_*) y al aplicar
// el cierre queda copiado en el detalle por jugador (weekly_closing_player_details.club_subagente_*), así cada semana conserva a quién
// pertenecía cada jugador en ese momento. Fénix GG no tiene importador: ahí no hay subagentes.
//
// Un subagente es (agente dueño + nombre del subagente), y se da de alta solo la primera vez que el agente abre su panel. El agente le
// pone su acuerdo por club (sistema, rakeback %, rebate %, versionado por vigencia igual que supervisor_acuerdos_agente) y le crea el
// usuario (rol SUBAGENTE, agent_users.subagente_id, agent_id NULL: el login del subagente nunca ve la cuenta del agente).
// Nada de esto toca los cierres ni lo que DigiPlayers le acredita al agente: es un acuerdo entre el agente y su subagente.
import bcrypt from "bcryptjs";
import { pool, newId } from "../db/pool.js";
import { calcularCierre } from "../engine/cierre.js";

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

let schemaListo: Promise<void> | null = null;
export function asegurarSchemaSubagentes(): Promise<void> {
  schemaListo ??= (async () => {
    await pool.query(`
      ALTER TABLE players ADD COLUMN IF NOT EXISTS club_subagente_id TEXT;
      ALTER TABLE players ADD COLUMN IF NOT EXISTS club_subagente_name TEXT;
      ALTER TABLE weekly_closing_player_details ADD COLUMN IF NOT EXISTS club_subagente_id TEXT;
      ALTER TABLE weekly_closing_player_details ADD COLUMN IF NOT EXISTS club_subagente_name TEXT;
      CREATE TABLE IF NOT EXISTS agente_subagentes (
        id         TEXT PRIMARY KEY,
        agent_id   TEXT NOT NULL REFERENCES agents(id),
        name       TEXT NOT NULL,
        name_key   TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (agent_id, name_key)
      );
      CREATE TABLE IF NOT EXISTS subagente_acuerdos (
        id            TEXT PRIMARY KEY,
        subagente_id  TEXT NOT NULL REFERENCES agente_subagentes(id),
        club_id       TEXT NOT NULL REFERENCES clubs(id),
        system        TEXT NOT NULL CHECK (system IN ('PREPAGO','WIN_LOSE')),
        rakeback_pct  NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (rakeback_pct >= 0 AND rakeback_pct <= 1),
        rebate_pct    NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (rebate_pct >= 0 AND rebate_pct <= 1),
        valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
        valid_to      TIMESTAMPTZ,
        created_by    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_subagente_acuerdos ON subagente_acuerdos(subagente_id, club_id, valid_from);
      ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS subagente_id TEXT REFERENCES agente_subagentes(id);`);
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_users_role_check' AND pg_get_constraintdef(oid) NOT LIKE '%SUBAGENTE%') THEN
          ALTER TABLE agent_users DROP CONSTRAINT agent_users_role_check;
          ALTER TABLE agent_users ADD CONSTRAINT agent_users_role_check CHECK (role IN ('AGENT','ADMIN','SUPERVISOR','PROVEEDOR','SOCIO','SUBAGENTE'));
        END IF;
      END $$;`);
  })().catch((err) => {
    schemaListo = null;
    throw err;
  });
  return schemaListo;
}

const clave = (s: string) => s.trim().toLowerCase();

/**
 * Subagente que informa el archivo para un jugador, o null si no hay (vacío, "-", o es el propio agente: los jugadores directos del
 * agente traen su mismo ID/nombre en esa columna).
 */
export function subagenteDeFila(row: {
  agentIdRaw?: string | null;
  agentNameRaw?: string | null;
  subAgentIdRaw?: string | null;
  subAgentNameRaw?: string | null;
}): { id: string | null; name: string } | null {
  const limpio = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t === "" || t === "-" || t === "--" ? null : t;
  };
  const id = limpio(row.subAgentIdRaw);
  const name = limpio(row.subAgentNameRaw) ?? id;
  if (!name) return null;
  const agId = limpio(row.agentIdRaw);
  const agName = limpio(row.agentNameRaw);
  if ((id && agId && id === agId) || (agName && clave(name) === clave(agName))) return null;
  return { id, name };
}

/** Da de alta (si faltan) los subagentes que aparecen entre los jugadores del agente. */
async function sincronizarSubagentes(agentId: string) {
  const r = await pool.query(
    `SELECT DISTINCT club_subagente_name AS name FROM (
       SELECT club_subagente_name FROM players WHERE agent_id = $1 AND club_subagente_name IS NOT NULL
       UNION
       SELECT d.club_subagente_name FROM weekly_closing_player_details d JOIN weekly_closings wc ON wc.id = d.closing_id
       WHERE wc.agent_id = $1 AND wc.status <> 'REVERTIDO' AND d.club_subagente_name IS NOT NULL
     ) x`,
    [agentId]
  );
  for (const row of r.rows) {
    await pool.query(
      `INSERT INTO agente_subagentes (id, agent_id, name, name_key) VALUES ($1,$2,$3,$4) ON CONFLICT (agent_id, name_key) DO NOTHING`,
      [newId("subag"), agentId, row.name.trim(), clave(row.name)]
    );
  }
}

async function subagenteDelAgente(agentId: string, subagenteId: string) {
  const r = await pool.query(`SELECT id, agent_id, name, name_key FROM agente_subagentes WHERE id = $1 AND agent_id = $2`, [subagenteId, agentId]);
  if (!r.rows[0]) throw new Error("Ese subagente no es tuyo.");
  return r.rows[0];
}

/** Acuerdo vigente para una semana (si se cargó después, vale el primero que hubo, igual que con los supervisores). */
function acuerdoParaSemana(acuerdos: any[], clubId: string, weekEnd: string) {
  const fecha = new Date(String(weekEnd).slice(0, 10) + "T23:59:59Z");
  const delClub = acuerdos.filter((a) => a.club_id === clubId);
  return (
    delClub
      .filter((a) => new Date(a.valid_from) <= fecha && (!a.valid_to || new Date(a.valid_to) > fecha))
      .sort((x, y) => +new Date(y.valid_from) - +new Date(x.valid_from))[0] ??
    delClub.sort((x, y) => +new Date(x.valid_from) - +new Date(y.valid_from))[0] ??
    null
  );
}

function calcular(agentId: string, clubId: string, ac: any, resultado: number, rake: number) {
  const c = calcularCierre({
    agentId,
    clubId,
    system: ac.system,
    result: resultado,
    rakeTotal: rake,
    rakebackPct: Number(ac.rakeback_pct),
    rebatePct: Number(ac.rebate_pct),
    rodeo: 0,
    ajusteManual: 0,
    rateSnapshot: 1,
  });
  return { rakeback: r2(c.rakeback), rebate: r2(c.rebate), cierre: r2(c.finalClosing) };
}

/**
 * Cierres de un subagente: de cada cierre semanal del agente, solo los jugadores que ese subagente tenía esa semana, calculados con
 * el acuerdo del agente con él. `margen` (lo que le queda al agente) solo se usa en el panel del agente, nunca va al subagente.
 */
async function cierresDelSubagente(sub: { id: string; agent_id: string; name_key: string }, limite = 40) {
  const filas = await pool.query(
    `SELECT wc.id AS closing_id, wc.club_id, c.name AS club_name, wc.week_start, wc.week_end,
            d.player_external_id, d.player_name, d.resultado, d.rake, d.cierre_jugador
     FROM weekly_closing_player_details d
     JOIN weekly_closings wc ON wc.id = d.closing_id
     JOIN clubs c ON c.id = wc.club_id
     WHERE wc.agent_id = $1 AND wc.status <> 'REVERTIDO' AND lower(trim(d.club_subagente_name)) = $2
     ORDER BY wc.week_start DESC, c.name, d.rake DESC, d.player_name`,
    [sub.agent_id, sub.name_key]
  );
  const acuerdos = (await pool.query(`SELECT * FROM subagente_acuerdos WHERE subagente_id = $1`, [sub.id])).rows;
  const porCierre = new Map<string, any>();
  for (const f of filas.rows) {
    if (!porCierre.has(f.closing_id)) {
      if (porCierre.size >= limite) continue;
      porCierre.set(f.closing_id, { id: f.closing_id, club_id: f.club_id, club_name: f.club_name, week_start: f.week_start, week_end: f.week_end, filas: [] });
    }
    porCierre.get(f.closing_id).filas.push(f);
  }
  return [...porCierre.values()].map((c) => {
    const resultado = r2(c.filas.reduce((t: number, f: any) => t + Number(f.resultado), 0));
    const rake = r2(c.filas.reduce((t: number, f: any) => t + Number(f.rake), 0));
    const delAgente = r2(c.filas.reduce((t: number, f: any) => t + Number(f.cierre_jugador), 0));
    const ac = acuerdoParaSemana(acuerdos, c.club_id, c.week_end);
    const base = { id: c.id, club_id: c.club_id, club_name: c.club_name, week_start: c.week_start, week_end: c.week_end, result: resultado, rake_total: rake };
    if (!ac) {
      return {
        ...base,
        sin_acuerdo: true,
        system: null,
        rakeback_pct: null,
        rakeback: null,
        rebate: null,
        final_closing: null,
        margen: null,
        jugadores_detalle: c.filas.map((f: any) => ({ id: f.player_external_id, nombre: f.player_name, resultado: Number(f.resultado), rake: Number(f.rake), rakeback: null, rebate: null, cierre: null })),
      };
    }
    const tot = calcular(sub.agent_id, c.club_id, ac, resultado, rake);
    return {
      ...base,
      sin_acuerdo: false,
      system: ac.system,
      rakeback_pct: Number(ac.rakeback_pct),
      rakeback: tot.rakeback,
      rebate: tot.rebate,
      final_closing: tot.cierre,
      // Lo que le queda al agente: lo que nosotros le liquidamos por esos jugadores menos lo que él le liquida al subagente.
      margen: r2(delAgente - tot.cierre),
      jugadores_detalle: c.filas.map((f: any) => ({
        id: f.player_external_id,
        nombre: f.player_name,
        resultado: Number(f.resultado),
        rake: Number(f.rake),
        ...calcular(sub.agent_id, c.club_id, ac, Number(f.resultado), Number(f.rake)),
      })),
    };
  });
}

/** Panel "Mis subagentes" del agente. */
export async function listarMisSubagentes(agentId: string) {
  await asegurarSchemaSubagentes();
  await sincronizarSubagentes(agentId);
  const subs = (await pool.query(`SELECT id, agent_id, name, name_key FROM agente_subagentes WHERE agent_id = $1 ORDER BY name`, [agentId])).rows;
  if (subs.length === 0) return [];
  const ids = subs.map((s) => s.id);
  const usuarios = await pool.query(
    `SELECT DISTINCT ON (subagente_id) subagente_id, id, email, active FROM agent_users
     WHERE role = 'SUBAGENTE' AND subagente_id = ANY($1::text[]) ORDER BY subagente_id, created_at`,
    [ids]
  );
  const acuerdos = await pool.query(
    `SELECT subagente_id, club_id, system, rakeback_pct, rebate_pct, valid_from FROM subagente_acuerdos WHERE valid_to IS NULL AND subagente_id = ANY($1::text[])`,
    [ids]
  );
  // Jugadores y clubes de cada subagente: los que hoy figuran en players + los que tuvo en algún cierre.
  const jug = await pool.query(
    `SELECT DISTINCT x.name_key, x.club_id, c.name AS club_name, x.external_id, x.nombre FROM (
       SELECT lower(trim(p.club_subagente_name)) AS name_key, p.club_id, p.external_id, p.display_name AS nombre
       FROM players p WHERE p.agent_id = $1 AND p.club_subagente_name IS NOT NULL
       UNION
       SELECT lower(trim(d.club_subagente_name)), wc.club_id, d.player_external_id, d.player_name
       FROM weekly_closing_player_details d JOIN weekly_closings wc ON wc.id = d.closing_id
       WHERE wc.agent_id = $1 AND wc.status <> 'REVERTIDO' AND d.club_subagente_name IS NOT NULL
     ) x JOIN clubs c ON c.id = x.club_id ORDER BY c.name, x.nombre`,
    [agentId]
  );
  const out = [];
  for (const s of subs) {
    const mios = jug.rows.filter((j) => j.name_key === s.name_key);
    const clubes = [...new Map(mios.map((j) => [j.club_id, { club_id: j.club_id, club_name: j.club_name }])).values()];
    const cierres = await cierresDelSubagente(s, 12);
    const u = usuarios.rows.find((x) => x.subagente_id === s.id);
    out.push({
      id: s.id,
      name: s.name,
      usuario: u ? { id: u.id, email: u.email, active: u.active } : null,
      jugadores: [...new Map(mios.map((j) => [`${j.club_id}|${j.external_id}`, { id: j.external_id, nombre: j.nombre, club_name: j.club_name }])).values()],
      clubes: clubes.map((c) => {
        const ac = acuerdos.rows.find((a) => a.subagente_id === s.id && a.club_id === c.club_id);
        return {
          ...c,
          acuerdo: ac ? { system: ac.system, rakeback_pct: Number(ac.rakeback_pct), rebate_pct: Number(ac.rebate_pct), desde: ac.valid_from } : null,
          ultima_semana: cierres.find((x) => x.club_id === c.club_id) ?? null,
        };
      }),
    });
  }
  return out;
}

/** Cuántos subagentes tiene el agente (para mostrar o no la sección en el menú). */
export async function contarMisSubagentes(agentId: string) {
  await asegurarSchemaSubagentes();
  await sincronizarSubagentes(agentId);
  const r = await pool.query(`SELECT count(*)::int AS n FROM agente_subagentes WHERE agent_id = $1`, [agentId]);
  return r.rows[0].n as number;
}

export async function crearUsuarioSubagente(agentId: string, subagenteId: string, email: string, password: string) {
  await asegurarSchemaSubagentes();
  await subagenteDelAgente(agentId, subagenteId);
  const ya = await pool.query(`SELECT 1 FROM agent_users WHERE subagente_id = $1 AND role = 'SUBAGENTE' LIMIT 1`, [subagenteId]);
  if (ya.rows[0]) throw new Error("Este subagente ya tiene usuario: cambiale la contraseña en vez de crear otro.");
  try {
    const id = newId("user");
    await pool.query(`INSERT INTO agent_users (id, agent_id, email, password_hash, role, subagente_id) VALUES ($1, NULL, $2, $3, 'SUBAGENTE', $4)`, [
      id,
      email.trim(),
      await bcrypt.hash(password, 10),
      subagenteId,
    ]);
    return { id, email: email.trim() };
  } catch (err: any) {
    if (err.code === "23505") throw new Error("Ese usuario ya existe: elegí otro.");
    throw err;
  }
}

export async function actualizarUsuarioSubagente(agentId: string, subagenteId: string, cambios: { password?: string; active?: boolean }) {
  await asegurarSchemaSubagentes();
  await subagenteDelAgente(agentId, subagenteId);
  const sets: string[] = [];
  const vals: any[] = [];
  if (cambios.password !== undefined) {
    vals.push(await bcrypt.hash(cambios.password, 10));
    sets.push(`password_hash = $${vals.length}`);
  }
  if (cambios.active !== undefined) {
    vals.push(cambios.active);
    sets.push(`active = $${vals.length}`);
  }
  if (sets.length === 0) throw new Error("Nada para cambiar.");
  vals.push(subagenteId);
  const r = await pool.query(
    `UPDATE agent_users SET ${sets.join(", ")} WHERE subagente_id = $${vals.length} AND role = 'SUBAGENTE' RETURNING id, email, active`,
    vals
  );
  if (!r.rows[0]) throw new Error("Este subagente todavía no tiene usuario.");
  return r.rows[0];
}

export async function guardarAcuerdoSubagente(
  agentId: string,
  subagenteId: string,
  input: { clubId: string; system: "PREPAGO" | "WIN_LOSE"; rakebackPct: number; rebatePct: number },
  creadoPor?: string | null
) {
  await asegurarSchemaSubagentes();
  await subagenteDelAgente(agentId, subagenteId);
  for (const [n, v] of [["rakeback", input.rakebackPct], ["rebate", input.rebatePct]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`El ${n} tiene que estar entre 0% y 100%.`);
  }
  const club = await pool.query(`SELECT 1 FROM clubs WHERE id = $1`, [input.clubId]);
  if (!club.rows[0]) throw new Error("No se encontró ese club.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE subagente_acuerdos SET valid_to = now() WHERE subagente_id = $1 AND club_id = $2 AND valid_to IS NULL`, [subagenteId, input.clubId]);
    const id = newId("sacu");
    await client.query(
      `INSERT INTO subagente_acuerdos (id, subagente_id, club_id, system, rakeback_pct, rebate_pct, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, subagenteId, input.clubId, input.system, input.rakebackPct, input.rebatePct, creadoPor ?? null]
    );
    await client.query("COMMIT");
    return { id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Portal del subagente: solo sus cierres con sus jugadores. Nunca el nombre del agente ni lo que le queda. */
export async function getMiSubagente(subagenteId: string) {
  await asegurarSchemaSubagentes();
  const r = await pool.query(`SELECT id, agent_id, name, name_key FROM agente_subagentes WHERE id = $1`, [subagenteId]);
  const sub = r.rows[0];
  if (!sub) throw new Error("Subagente no encontrado.");
  const cierres = (await cierresDelSubagente(sub)).map(({ margen: _m, ...c }) => c);
  return { nombre: sub.name, cierres };
}
