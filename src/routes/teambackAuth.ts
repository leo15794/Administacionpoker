// TeamBack Affiliates V1 (25/09/2026) -- login PROPIO de la sección, totalmente aparte de
// routes/auth.ts (mismo patrón: bcrypt, mensaje genérico, rate limit de fuerza bruta -- ver ahí
// los comentarios del análisis de seguridad del 24/09 que motivan cada uno de estos detalles).
// (25/09/2026, pedido de Leo: "recorda que no sea obligacion el email, puede ser usuario y
// contraseña sin obligacion del email") -- login por USUARIO, no por email.
import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { getTbUserByUsername } from "../repo/teamback.js";
import { signTbToken } from "../lib/tbAuth.js";

export const teambackAuthRouter = Router();

const tbLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a intentar." },
});

teambackAuthRouter.post("/login", tbLoginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ error: "usuario y contraseña son requeridos" });

    const user = await getTbUserByUsername(String(username).trim().toLowerCase());
    // Mensaje genérico a propósito: no revelar si el usuario existe o no.
    if (!user) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Usuario o contraseña incorrectos." });

    if (user.active === false) return res.status(403).json({ error: "Este usuario está desactivado." });

    const token = signTbToken({ userId: user.id, role: user.role, username: user.username, playerId: user.player_id ?? null });
    res.json({ token, role: user.role, name: user.name, playerId: user.player_id ?? null });
  } catch (err: any) {
    console.error("Error en /teamback/auth/login:", err);
    res.status(500).json({ error: "Error interno en login" });
  }
});
