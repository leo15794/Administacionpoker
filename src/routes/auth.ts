import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool, newId } from "../db/pool.js";
import { signToken, requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth.js";
import { pedirClave } from "../repo/pedidosClave.js";
import { estadoAcceso, MENSAJE_ACCESO, asegurarSchemaSesiones, registrarHistorial, problemaContrasena } from "../lib/sesiones.js";

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
      `INSERT INTO agent_users (id, agent_id, email, password_hash, role, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, agent.rows[0].id, email, passwordHash, role === "ADMIN" ? "ADMIN" : "AGENT", (req as AuthedRequest).user?.userId ?? null]
    );
    await registrarHistorial(pool, id, "CREADO", (req as AuthedRequest).user?.userId ?? null);
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
    await asegurarSchemaSesiones();

    // LEFT JOIN a los dos (16/10/2026, rol PROVEEDOR): un login puede colgar de un agente O de
    // un proveedor, nunca los dos -- con INNER JOIN de antes, un login de proveedor (agent_id
    // NULL) jamás hubiera podido loguearse.
    const r = await pool.query(
      `SELECT u.*, a.name as agent_name, p.name as proveedor_name
       FROM agent_users u
       LEFT JOIN agents a ON a.id = u.agent_id
       LEFT JOIN proveedores p ON p.id = u.proveedor_id
       WHERE email = $1`,
      [email]
    );
    const user = r.rows[0];
    // Mensaje genérico a propósito: no revelar si el email existe o no.
    if (!user) return res.status(401).json({ error: "Email o contraseña incorrectos." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Email o contraseña incorrectos." });

    if (user.active === false) return res.status(403).json({ error: "Este usuario está desactivado." });
    const acceso = await estadoAcceso(user.id);
    if (!acceso.ok) return res.status(403).json({ error: MENSAJE_ACCESO[acceso.motivo] });

    const token = signToken({
      userId: user.id,
      agentId: user.agent_id,
      role: user.role,
      email: user.email,
      proveedorId: user.proveedor_id,
      partnerAccountId: user.partner_account_id ?? null,
      subagenteId: user.subagente_id ?? null,
      cambiarClave: user.must_change_password === true,
    });
    await pool.query(`UPDATE agent_users SET last_login_at = now() WHERE id = $1`, [user.id]);
    let nombreSocio: string | null = null;
    if (user.role === "SOCIO" && user.partner_account_id) {
      nombreSocio = (await pool.query(`SELECT name FROM partner_accounts WHERE id = $1`, [user.partner_account_id])).rows[0]?.name ?? null;
    }
    let nombreSubagente: string | null = null;
    if (user.role === "SUBAGENTE" && user.subagente_id) {
      nombreSubagente = (await pool.query(`SELECT name FROM agente_subagentes WHERE id = $1`, [user.subagente_id])).rows[0]?.name ?? null;
    }
    res.json({ token, agentName: user.agent_name ?? user.proveedor_name ?? nombreSocio ?? nombreSubagente, role: user.role, cambiarClave: user.must_change_password === true });
  } catch (err: any) {
    // (24/09/2026, encontrado en análisis de seguridad) -- antes esto devolvía el mensaje crudo
    // del error (podía ser un error de Postgres con nombres de tabla/columna) al cliente. El
    // detalle real solo queda en los logs del servidor -- al que hace login nunca le hace falta
    // saber POR QUÉ falló técnicamente, y no corresponde exponerlo.
    console.error("Error en /auth/login:", err);
    res.status(500).json({ error: "Error interno en login" });
  }
});

// Elegir la contraseña propia (10/11/2026, punto 2): obligatorio al entrar con una temporal; sirve también para cambiarla cuando quiera.
// Devuelve un token nuevo, porque el cambio de contraseña corta las sesiones anteriores (ver lib/sesiones.ts).
authRouter.post("/cambiar-clave", requireAuth, async (req: AuthedRequest, res) => {
  const nueva = typeof req.body?.nueva === "string" ? req.body.nueva : "";
  try {
    const r = await pool.query(`SELECT id, email, password_hash FROM agent_users WHERE id = $1`, [req.user!.userId]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: "Usuario no encontrado." });
    const problema = problemaContrasena(nueva, u.email);
    if (problema) return res.status(400).json({ error: problema });
    if (await bcrypt.compare(nueva, u.password_hash)) return res.status(400).json({ error: "Elegí una contraseña distinta a la que tenías." });
    await pool.query(`UPDATE agent_users SET password_hash = $1, must_change_password = false WHERE id = $2`, [await bcrypt.hash(nueva, 10), u.id]);
    await registrarHistorial(pool, u.id, "CLAVE_ELEGIDA", u.id);
    const { iat: _iat, exp: _exp, ...resto } = req.user as any;
    res.json({ token: signToken({ ...resto, cambiarClave: false }), role: req.user!.role });
  } catch (err) {
    console.error("Error en /auth/cambiar-clave:", err);
    res.status(500).json({ error: "No se pudo cambiar la contraseña." });
  }
});

// "Olvidé mi contraseña" (10/11/2026, mockup 89): avisa a quien puede resetearla (ver repo/pedidosClave.ts). Siempre responde lo mismo, exista
// o no el usuario, y tiene su propio límite de pedidos.
const olvideLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Esperá unos minutos y volvé a intentar." },
});
authRouter.post("/olvide-clave", olvideLimiter, async (req, res) => {
  const usuario = typeof req.body?.usuario === "string" ? req.body.usuario.trim() : "";
  if (usuario.length < 2) return res.status(400).json({ error: "Escribí tu usuario." });
  try {
    await pedirClave(usuario);
  } catch (err) {
    console.error("Error en /auth/olvide-clave:", err);
  }
  res.json({ ok: true });
});
