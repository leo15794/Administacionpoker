// Acuerdos del supervisor con sus agentes (05/11/2026, pedido de Leo: "que los supervisores le puedan crear una cuenta a sus
// agentes para que puedan ver lo que pasa, con los % de todo lo mismo que nosotros asignamos; ellos tienen el control").
//
// Son un acuerdo ENTRE el supervisor y su agente: sistema, rakeback % y rebate % por club, versionados por vigencia (igual que
// agent_club_deals). NO tocan los cierres semanales ni lo que DigiPlayers le acredita al supervisor -- eso sigue saliendo de
// nuestros deals (agent_club_deals). Solo se usan para lo que ve el agente en su portal: su cierre de cada semana calculado
// con los % de su supervisor.
//
// El supervisor también crea (y resetea / desactiva) el login de sus agentes, siempre rol AGENT y solo de agentes que tiene a
// cargo (agents.supervisor = su nombre). Todo se valida acá contra su propio id de login, nunca contra lo que mande el cliente.
import bcrypt from "bcryptjs";
import { pool, newId } from "../db/pool.js";
import { calcularCierre } from "../engine/cierre.js";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

let tablaLista: Promise<void> | null = null;
export function asegurarTablaAcuerdos(): Promise<void> {
  tablaLista ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS supervisor_acuerdos_agente (
        id                  TEXT PRIMARY KEY,
        supervisor_agent_id TEXT NOT NULL REFERENCES agents(id),
        agent_id            TEXT NOT NULL REFERENCES agents(id),
        club_id             TEXT NOT NULL REFERENCES clubs(id),
        system              TEXT NOT NULL CHECK (system IN ('PREPAGO','WIN_LOSE')),
        rakeback_pct        NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (rakeback_pct >= 0 AND rakeback_pct <= 1),
        rebate_pct          NUMERIC(6,4) NOT NULL DEFAULT 0 CHECK (rebate_pct >= 0 AND rebate_pct <= 1),
        valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
        valid_to            TIMESTAMPTZ,
        created_by          TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_sup_acuerdos_agente ON supervisor_acuerdos_agente(agent_id, club_id, valid_from);`
    )
    .then(() => undefined)
    .catch((err) => {
      tablaLista = null;
      throw err;
    });
  return tablaLista;
}

/** El agente tiene que estar activo y a cargo de este supervisor; si no, error (nunca se confía en el id de la URL). */
async function agenteDelSupervisor(supervisorAgentId: string, agentId: string) {
  const r = await pool.query(
    `SELECT a.id, a.name FROM agents a JOIN agents s ON s.id = $1
     WHERE a.id = $2 AND a.active = true AND a.supervisor = s.name AND a.id <> s.id`,
    [supervisorAgentId, agentId]
  );
  if (!r.rows[0]) throw new Error("Ese agente no está a tu cargo.");
  return r.rows[0];
}

/** Agentes a cargo con su login (si tiene), los clubes donde opera y el acuerdo vigente en cada uno. */
export async function listarMisAgentes(supervisorAgentId: string) {
  await asegurarTablaAcuerdos();
  const agentes = await pool.query(
    `SELECT a.id, a.name, a.account_type FROM agents a JOIN agents s ON s.id = $1
     WHERE a.active = true AND a.supervisor = s.name AND a.id <> s.id ORDER BY a.name`,
    [supervisorAgentId]
  );
  const ids = agentes.rows.map((a) => a.id);
  if (ids.length === 0) return [];
  const usuarios = await pool.query(
    `SELECT DISTINCT ON (u.agent_id) u.agent_id, u.id, u.email, u.active, u.created_at
     FROM agent_users u WHERE u.role = 'AGENT' AND u.agent_id = ANY($1::text[])
     ORDER BY u.agent_id, u.created_at`,
    [ids]
  );
  // Clubes del agente: donde tiene deal vigente o algún cierre. Solo el nombre -- nuestros % no se muestran.
  const clubes = await pool.query(
    `SELECT DISTINCT x.agent_id, c.id AS club_id, c.name AS club_name FROM (
       SELECT agent_id, club_id FROM agent_club_deals WHERE valid_to IS NULL AND agent_id = ANY($1::text[])
       UNION SELECT agent_id, club_id FROM weekly_closings WHERE status <> 'REVERTIDO' AND agent_id = ANY($1::text[])
     ) x JOIN clubs c ON c.id = x.club_id
     ORDER BY c.name`,
    [ids]
  );
  const acuerdos = await pool.query(
    `SELECT agent_id, club_id, system, rakeback_pct, rebate_pct, valid_from FROM supervisor_acuerdos_agente
     WHERE valid_to IS NULL AND supervisor_agent_id = $1 AND agent_id = ANY($2::text[])`,
    [supervisorAgentId, ids]
  );
  // Última semana de cada agente en cada club, calculada con el acuerdo (para "así ve su última semana" del panel del supervisor).
  const ultimos = await pool.query(
    `SELECT DISTINCT ON (wc.agent_id, wc.club_id) wc.*, c.name AS club_name
     FROM weekly_closings wc JOIN clubs c ON c.id = wc.club_id
     WHERE wc.status <> 'REVERTIDO' AND wc.agent_id = ANY($1::text[])
     ORDER BY wc.agent_id, wc.club_id, wc.week_start DESC`,
    [ids]
  );
  const vistaUltima = new Map<string, any>();
  for (const id of ids) {
    const filas = ultimos.rows.filter((r) => r.agent_id === id);
    if (filas.length === 0) continue;
    for (const v of await cierresConAcuerdo(id, filas)) vistaUltima.set(`${id}|${v.club_id}`, v);
  }
  return agentes.rows.map((a) => {
    const u = usuarios.rows.find((x) => x.agent_id === a.id);
    return {
      id: a.id,
      name: a.name,
      account_type: a.account_type,
      usuario: u ? { id: u.id, email: u.email, active: u.active } : null,
      clubes: clubes.rows
        .filter((c) => c.agent_id === a.id)
        .map((c) => {
          const ac = acuerdos.rows.find((x) => x.agent_id === a.id && x.club_id === c.club_id);
          return {
            club_id: c.club_id,
            club_name: c.club_name,
            acuerdo: ac ? { system: ac.system, rakeback_pct: Number(ac.rakeback_pct), rebate_pct: Number(ac.rebate_pct), desde: ac.valid_from } : null,
            ultima_semana: vistaUltima.get(`${a.id}|${c.club_id}`) ?? null,
          };
        }),
    };
  });
}

export async function crearUsuarioAgente(supervisorAgentId: string, agentId: string, email: string, password: string) {
  await agenteDelSupervisor(supervisorAgentId, agentId);
  const ya = await pool.query(`SELECT 1 FROM agent_users WHERE agent_id = $1 AND role = 'AGENT' LIMIT 1`, [agentId]);
  if (ya.rows[0]) throw new Error("Este agente ya tiene usuario: cambiale la contraseña en vez de crear otro.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = newId("user");
    await client.query(`INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,'AGENT')`, [
      id,
      agentId,
      email.trim(),
      await bcrypt.hash(password, 10),
    ]);
    await client.query(`INSERT INTO agent_user_agents (user_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, agentId]);
    await client.query("COMMIT");
    return { id, email: email.trim() };
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") throw new Error("Ese usuario ya existe: elegí otro.");
    throw err;
  } finally {
    client.release();
  }
}

/** Solo el login AGENT de ese agente: nunca toca un usuario de otro rol (admin, supervisor, proveedor...). */
export async function actualizarUsuarioAgente(supervisorAgentId: string, agentId: string, cambios: { password?: string; active?: boolean }) {
  await agenteDelSupervisor(supervisorAgentId, agentId);
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
  vals.push(agentId);
  const r = await pool.query(`UPDATE agent_users SET ${sets.join(", ")} WHERE agent_id = $${vals.length} AND role = 'AGENT' RETURNING id, email, active`, vals);
  if (!r.rows[0]) throw new Error("Este agente todavía no tiene usuario.");
  return r.rows[0];
}

/** Guarda el acuerdo de un club (cierra el vigente y abre uno nuevo, así las semanas viejas se siguen viendo con el de antes). */
export async function guardarAcuerdo(
  supervisorAgentId: string,
  agentId: string,
  input: { clubId: string; system: "PREPAGO" | "WIN_LOSE"; rakebackPct: number; rebatePct: number },
  creadoPor?: string | null
) {
  await asegurarTablaAcuerdos();
  await agenteDelSupervisor(supervisorAgentId, agentId);
  for (const [n, v] of [["rakeback", input.rakebackPct], ["rebate", input.rebatePct]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`El ${n} tiene que estar entre 0% y 100%.`);
  }
  const club = await pool.query(`SELECT 1 FROM clubs WHERE id = $1`, [input.clubId]);
  if (!club.rows[0]) throw new Error("No se encontró ese club.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE supervisor_acuerdos_agente SET valid_to = now() WHERE supervisor_agent_id = $1 AND agent_id = $2 AND club_id = $3 AND valid_to IS NULL`,
      [supervisorAgentId, agentId, input.clubId]
    );
    const id = newId("sacu");
    await client.query(
      `INSERT INTO supervisor_acuerdos_agente (id, supervisor_agent_id, agent_id, club_id, system, rakeback_pct, rebate_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, supervisorAgentId, agentId, input.clubId, input.system, input.rakebackPct, input.rebatePct, creadoPor ?? null]
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

/**
 * Para el portal del agente: sus cierres recalculados con el acuerdo de su supervisor vigente al cierre de cada semana.
 * Sin acuerdo para ese club y semana, el cierre se muestra sin monto (nunca con nuestros %).
 */
export async function cierresConAcuerdo(agentId: string, cierres: any[]) {
  await asegurarTablaAcuerdos();
  const acuerdos = await pool.query(
    `SELECT club_id, system, rakeback_pct, rebate_pct, valid_from, valid_to FROM supervisor_acuerdos_agente WHERE agent_id = $1`,
    [agentId]
  );
  const vigente = (clubId: string, fecha: Date) =>
    acuerdos.rows
      .filter((a) => a.club_id === clubId && new Date(a.valid_from) <= fecha && (!a.valid_to || new Date(a.valid_to) > fecha))
      .sort((x, y) => +new Date(y.valid_from) - +new Date(x.valid_from))[0] ??
    // Si el acuerdo se cargó después de la semana, para esa semana vale el primero que hubo (así no quedan semanas viejas en blanco).
    acuerdos.rows.filter((a) => a.club_id === clubId).sort((x, y) => +new Date(x.valid_from) - +new Date(y.valid_from))[0];
  return cierres.map((c) => {
    const base = {
      id: c.id,
      week_start: c.week_start,
      week_end: c.week_end,
      club_id: c.club_id,
      club_name: c.club_name,
      result: Number(c.result),
      rake_total: Number(c.rake_total),
      status: c.status,
    };
    const ac = vigente(c.club_id, new Date(String(c.week_end).slice(0, 10) + "T23:59:59Z"));
    if (!ac) return { ...base, sin_acuerdo: true, system: null, rakeback_pct: null, rakeback: null, rebate_pct: null, rebate: null, final_closing: null };
    const calc = calcularCierre({
      agentId,
      clubId: c.club_id,
      system: ac.system,
      result: Number(c.result),
      rakeTotal: Number(c.rake_total),
      rakebackPct: Number(ac.rakeback_pct),
      rebatePct: Number(ac.rebate_pct),
      rodeo: 0,
      ajusteManual: 0,
      rateSnapshot: 1,
    });
    return {
      ...base,
      sin_acuerdo: false,
      system: ac.system,
      rakeback_pct: Number(ac.rakeback_pct),
      rakeback: round2(calc.rakeback),
      rebate_pct: Number(ac.rebate_pct),
      rebate: round2(calc.rebate),
      final_closing: round2(calc.finalClosing),
    };
  });
}

/** Acuerdos vigentes del agente (para mostrarle "tu acuerdo con tu supervisor"). */
export async function acuerdosVigentesDelAgente(agentId: string) {
  await asegurarTablaAcuerdos();
  const r = await pool.query(
    `SELECT a.club_id, c.name AS club_name, a.system, a.rakeback_pct, a.rebate_pct, a.valid_from
     FROM supervisor_acuerdos_agente a JOIN clubs c ON c.id = a.club_id
     WHERE a.agent_id = $1 AND a.valid_to IS NULL ORDER BY c.name`,
    [agentId]
  );
  return r.rows.map((x) => ({ ...x, rakeback_pct: Number(x.rakeback_pct), rebate_pct: Number(x.rebate_pct) }));
}
