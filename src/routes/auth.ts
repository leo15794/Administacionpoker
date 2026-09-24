import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool, newId } from "../db/pool.js";
import { signToken, requireAuth, requireAdmin } from "../lib/auth.js";

export const authRouter = Router();

// (24/09/2026, encontrado en análisis de seguridad) -- /login no tenía ningún límite de
// intentos: alguien podía probar contraseñas sin parar contra un email real (fuerza bruta). 20
// intentos cada 15 minutos por IP alcanza de sobra para un login normal (incluso con typos) y
// frena un ataque automatizado. No cuenta los intentos que salen bien (skipSuccessfulRequests),
// así que un usuario legítimo que ya entró no gasta cupo.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a intentar." },
});

// Crea (o resetea la contraseña de) un usuario de portal para un agente existente.
// Protegido: solo un ADMIN ya logueado puede crear otros usuarios.
authRouter.post("/bootstrap-user", requireAuth, requireAdmin, async (req, res) => {
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

authRouter.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: "email y contraseña son requeridos" });

    const r = await pool.query(
      `SELECT u.*, a.name as agent_name FROM agent_users u JOIN agents a ON a.id = u.agent_id WHERE email = $1`,
      [email]
    );
    const user = r.rows[0];
    // Mensaje genérico a propósito: no revelar si el email existe o no.
    if (!user) return res.status(401).json({ error: "Email o contraseña incorrectos." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Email o contraseña incorrectos." });

    if (user.active === false) return res.status(403).json({ error: "Este usuario está desactivado." });

    const token = signToken({ userId: user.id, agentId: user.agent_id, role: user.role, email: user.email });
    res.json({ token, agentName: user.agent_name, role: user.role });
  } catch (err: any) {
    // (24/09/2026, encontrado en análisis de seguridad) -- antes esto devolvía el mensaje crudo
    // del error (podía ser un error de Postgres con nombres de tabla/columna) al cliente. El
    // detalle real solo queda en los logs del servidor -- al que hace login nunca le hace falta
    // saber POR QUÉ falló técnicamente, y no corresponde exponerlo.
    console.error("Error en /auth/login:", err);
    res.status(500).json({ error: "Error interno en login" });
  }
});
