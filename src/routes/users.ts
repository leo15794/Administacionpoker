import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, newId } from "../db/pool.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";

export const usersRouter = Router();

// Listado de usuarios de acceso (para el panel de administración de usuarios). Un mismo login
// puede tener varios agentes/clubes asociados (agent_user_agents) — se traen todos agregados
// para que la tabla muestre "TeamBack Suprema, Fénix GG" en vez de un solo nombre.
usersRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT u.id, u.email, u.role, u.active, u.created_at, u.agent_id,
            COALESCE(
              (SELECT json_agg(json_build_object('id', a2.id, 'name', a2.name) ORDER BY a2.name)
               FROM agent_user_agents uax JOIN agents a2 ON a2.id = uax.agent_id
               WHERE uax.user_id = u.id),
              json_build_array(json_build_object('id', a.id, 'name', a.name))
            ) as agentes
     FROM agent_users u JOIN agents a ON a.id = u.agent_id
     ORDER BY u.created_at DESC`
  );
  res.json(r.rows);
});

// Usuario/login: ya no se exige formato de email — puede ser un email real o un nombre de
// usuario simple (ej. "juan123"), solo tiene que ser único (ver índice UNIQUE en agent_users.email).
const usuarioField = z.string().trim().min(3, "Mínimo 3 caracteres.");

const createSchema = z.object({
  agentIds: z.array(z.string()).min(1, "Elegí al menos un agente."),
  // Cuenta de acceso por defecto (la que usa el login/JWT al entrar): elegida explícitamente
  // por el admin, no "la primera que se tildó" — para un login con varios agentes, todos
  // pesan igual en el selector de arriba, esto es una decisión aparte.
  defaultAgentId: z.string().min(1),
  email: usuarioField,
  password: z.string().min(6),
  role: z.enum(["ADMIN", "AGENT", "SUPERVISOR"]),
});
usersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { agentIds, defaultAgentId, email, password, role } = parsed.data;
  if (!agentIds.includes(defaultAgentId)) {
    return res.status(400).json({ error: "La cuenta de acceso por defecto tiene que ser uno de los agentes tildados." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, 10);
    const id = newId("user");
    await client.query(
      `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, defaultAgentId, email, hash, role]
    );
    for (const agentId of agentIds) {
      await client.query(
        `INSERT INTO agent_user_agents (user_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [id, agentId]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id, email, role });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Ese usuario ya existe." });
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

const updateSchema = z.object({
  email: usuarioField.optional(),
  role: z.enum(["ADMIN", "AGENT", "SUPERVISOR"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
  agentIds: z.array(z.string()).min(1).optional(),
  // Cuenta de acceso por defecto: si se manda agentIds, hay que decir cuál de esos usar como
  // agent_id — ya no se infiere "la primera tildada" (todas pesan igual en ese selector).
  defaultAgentId: z.string().min(1).optional(),
});
usersRouter.patch("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, role, active, password, agentIds, defaultAgentId } = parsed.data;

  // Nunca dejar que un admin se saque su propio acceso por error (quedaría el sistema sin admin).
  if (req.params.id === req.user?.userId && (active === false || role === "AGENT")) {
    return res.status(400).json({ error: "No podés quitarte tu propio acceso de administrador." });
  }

  if (agentIds !== undefined) {
    if (!defaultAgentId) {
      return res.status(400).json({ error: "Falta indicar la cuenta de acceso por defecto." });
    }
    if (!agentIds.includes(defaultAgentId)) {
      return res.status(400).json({ error: "La cuenta de acceso por defecto tiene que ser uno de los agentes tildados." });
    }
  }

  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (email !== undefined) {
    sets.push(`email = $${i++}`);
    values.push(email);
  }
  if (role !== undefined) {
    sets.push(`role = $${i++}`);
    values.push(role);
  }
  if (active !== undefined) {
    sets.push(`active = $${i++}`);
    values.push(active);
  }
  if (password !== undefined) {
    sets.push(`password_hash = $${i++}`);
    values.push(await bcrypt.hash(password, 10));
  }
  if (defaultAgentId !== undefined) {
    sets.push(`agent_id = $${i++}`);
    values.push(defaultAgentId);
  }

  if (sets.length === 0 && agentIds === undefined) return res.status(400).json({ error: "Nada para actualizar." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row;
    if (sets.length > 0) {
      values.push(req.params.id);
      const r = await client.query(
        `UPDATE agent_users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, email, role, active`,
        values
      );
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado." });
      }
      row = r.rows[0];
    } else {
      const r = await client.query(`SELECT id, email, role, active FROM agent_users WHERE id = $1`, [req.params.id]);
      if (r.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Usuario no encontrado." });
      }
      row = r.rows[0];
    }
    if (agentIds !== undefined) {
      await client.query(`DELETE FROM agent_user_agents WHERE user_id = $1`, [req.params.id]);
      for (const agentId of agentIds) {
        await client.query(
          `INSERT INTO agent_user_agents (user_id, agent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.id, agentId]
        );
      }
    }
    await client.query("COMMIT");
    res.json(row);
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Ese usuario ya existe." });
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Borrado real de un login de portal. No toca el agente ni su historial de cierres/movimientos
// (eso es del negocio, no del acceso) — solo borra la CUENTA DE ACCESO: agent_user_agents
// (cascada), su configuración de comisiones por referido si era Supervisor (referidos +
// movimientos, cascada manual porque los movimientos no tienen ON DELETE CASCADE — se
// preserva el criterio de no dejar rastros huérfanos), y la fila de agent_users.
usersRouter.delete("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  if (req.params.id === req.user?.userId) {
    return res.status(400).json({ error: "No podés eliminar tu propio usuario." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const check = await client.query(`SELECT id, email FROM agent_users WHERE id = $1`, [req.params.id]);
    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    await client.query(
      `DELETE FROM supervisor_referido_movements WHERE referido_id IN (SELECT id FROM supervisor_referidos WHERE supervisor_user_id = $1)`,
      [req.params.id]
    );
    await client.query(`DELETE FROM supervisor_referidos WHERE supervisor_user_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM agent_users WHERE id = $1`, [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true, email: check.rows[0].email });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================
// Comisión por referido de supervisor (16/09/2026)
// Cuelga del LOGIN (no de un agente): un supervisor puede tener % configurado sobre el rake
// semanal de un agente que él refirió, auto-acreditado en cada cierre semanal de ese agente
// (ver src/repo/closings.ts) como saldo separado. A propósito NO depende de cuál sea la cuenta
// principal de este login — eso es un tema de permisos/visualización aparte.
// ============================================================

usersRouter.get("/:id/referidos", requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(
    `SELECT r.*, a.name as agente_referido_name
     FROM supervisor_referidos r JOIN agents a ON a.id = r.agente_referido_id
     WHERE r.supervisor_user_id = $1 AND r.active = true
     ORDER BY a.name`,
    [req.params.id]
  );
  res.json(r.rows);
});

const crearReferidoSchema = z.object({
  agenteReferidoId: z.string().min(1),
  porcentaje: z.number().gt(0).lte(100),
});
usersRouter.post("/:id/referidos", requireAuth, requireAdmin, async (req, res) => {
  const parsed = crearReferidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { agenteReferidoId, porcentaje } = parsed.data;
  try {
    const id = newId("refsup");
    const r = await pool.query(
      `INSERT INTO supervisor_referidos (id, supervisor_user_id, agente_referido_id, porcentaje)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, req.params.id, agenteReferidoId, porcentaje]
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese agente ya tiene un referidor activo — desactivalo primero si querés cambiarlo de supervisor." });
    }
    res.status(400).json({ error: err.message });
  }
});

const editarReferidoSchema = z.object({
  porcentaje: z.number().gt(0).lte(100).optional(),
  active: z.boolean().optional(),
});
usersRouter.patch("/referidos/:refId", requireAuth, requireAdmin, async (req, res) => {
  const parsed = editarReferidoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
  if (parsed.data.porcentaje !== undefined) {
    sets.push(`porcentaje = $${i++}`);
    values.push(parsed.data.porcentaje);
  }
  if (parsed.data.active !== undefined) {
    sets.push(`active = $${i++}`);
    values.push(parsed.data.active);
  }
  if (sets.length === 0) return res.status(400).json({ error: "Nada para actualizar." });
  sets.push(`updated_at = now()`);
  values.push(req.params.refId);
  const r = await pool.query(`UPDATE supervisor_referidos SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
  if (r.rows.length === 0) return res.status(404).json({ error: "No se encontró ese referido." });
  res.json(r.rows[0]);
});
