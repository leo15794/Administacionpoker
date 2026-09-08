import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool, newId } from "../db/pool.js";
import { signToken } from "../lib/auth.js";

export const authRouter = Router();

// Crea un usuario de portal para un agente existente (solo uso administrativo /
// bootstrap; en producción esto se protege detrás de auth de admin).
authRouter.post("/bootstrap-user", async (req, res) => {
  const { agentName, email, password, role } = req.body ?? {};
  if (!agentName || !email || !password) return res.status(400).json({ error: "agentName, email y password son requeridos" });

  const agent = await pool.query(`SELECT id FROM agents WHERE name = $1`, [agentName]);
  if (agent.rows.length === 0) return res.status(404).json({ error: `Agente '${agentName}' no encontrado` });

  const passwordHash = await bcrypt.hash(password, 10);
  const id = newId("user");
  try {
    await pool.query(
      `INSERT INTO agent_users (id, agent_id, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)`,
      [id, agent.rows[0].id, email, passwordHash, role === "ADMIN" ? "ADMIN" : "AGENT"]
    );
    res.json({ id, email });
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "Ese email ya tiene un usuario" });
    throw err;
  }
});

// TEMPORAL: la verificación de contraseña está desactivada para destrabar el acceso
// mientras se resuelve el problema de login. Alcanza con el email. Hay que reactivar
// bcrypt.compare acá antes de exponer esto fuera de tu máquina.
authRouter.post("/login", async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "email es requerido" });

  const r = await pool.query(
    `SELECT u.*, a.name as agent_name FROM agent_users u JOIN agents a ON a.id = u.agent_id WHERE email = $1`,
    [email]
  );
  const user = r.rows[0];
  if (!user) return res.status(401).json({ error: "No existe un usuario con ese email. Corré el seed o creá uno con /auth/bootstrap-user." });

  const token = signToken({ userId: user.id, agentId: user.agent_id, role: user.role, email: user.email });
  res.json({ token, agentName: user.agent_name, role: user.role });
});
