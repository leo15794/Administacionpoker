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
  email: usuarioField,
  password: z.string().min(6),
  role: z.enum(["ADMIN", "AGENT", "SUPERVISOR"]),
});
usersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { agentIds, email, password, role } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hash = await bcrypt.hash(password, 10);
    const id = newId("user");
    // agentIds[0] queda como "cuenta principal" (agent_id de agent_users) — la que usa el login
    // por default; el resto (y esta misma) quedan además en agent_user_agents para el selector.
    await client.query(
      `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, agentIds[0], email, hash, role]
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
});
usersRouter.patch("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, role, active, password, agentIds } = parsed.data;

  // Nunca dejar que un admin se saque su propio acceso por error (quedaría el sistema sin admin).
  if (req.params.id === req.user?.userId && (active === false || role === "AGENT")) {
    return res.status(400).json({ error: "No podés quitarte tu propio acceso de administrador." });
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
  // agentIds[0] pisa también la "cuenta principal" (agent_id) — mantiene consistente cuál usa
  // el JWT/login por default con lo que se ve en el selector de "Mi cuenta".
  if (agentIds !== undefined) {
    sets.push(`agent_id = $${i++}`);
    values.push(agentIds[0]);
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
