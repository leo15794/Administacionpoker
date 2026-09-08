import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool, newId } from "../db/pool.js";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";

export const usersRouter = Router();

// Listado de usuarios de acceso (para el panel de administración de usuarios).
usersRouter.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT u.id, u.email, u.role, u.active, u.created_at, a.id as agent_id, a.name as agent_name
     FROM agent_users u JOIN agents a ON a.id = u.agent_id
     ORDER BY u.created_at DESC`
  );
  res.json(r.rows);
});

const createSchema = z.object({
  agentId: z.string(),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["ADMIN", "AGENT"]),
});
usersRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { agentId, email, password, role } = parsed.data;
  try {
    const hash = await bcrypt.hash(password, 10);
    const id = newId("user");
    await pool.query(
      `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, agentId, email, hash, role]
    );
    res.status(201).json({ id, email, role });
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "Ese email ya tiene un usuario." });
    res.status(400).json({ error: err.message });
  }
});

const updateSchema = z.object({
  role: z.enum(["ADMIN", "AGENT"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});
usersRouter.patch("/:id", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { role, active, password } = parsed.data;

  // Nunca dejar que un admin se saque su propio acceso por error (quedaría el sistema sin admin).
  if (req.params.id === req.user?.userId && (active === false || role === "AGENT")) {
    return res.status(400).json({ error: "No podés quitarte tu propio acceso de administrador." });
  }

  const sets: string[] = [];
  const values: any[] = [];
  let i = 1;
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
  if (sets.length === 0) return res.status(400).json({ error: "Nada para actualizar." });

  values.push(req.params.id);
  const r = await pool.query(
    `UPDATE agent_users SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, email, role, active`,
    values
  );
  if (r.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado." });
  res.json(r.rows[0]);
});
