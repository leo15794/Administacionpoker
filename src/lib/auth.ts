import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

// (24/09/2026, encontrado en análisis de seguridad) -- ANTES esto caía a un secreto hardcodeado
// ("dev-secret") si faltaba la variable de entorno JWT_SECRET. Eso es gravísimo en producción:
// como el código es visible (repo propio, no público, pero igual), cualquiera que supiera ese
// fallback podría firmar un token con role: "ADMIN" para el agentId/email que quisiera y
// entrar como admin sin contraseña. Ahora, si falta la variable, el proceso ni arranca -- mejor
// que se rompa fuerte al desplegar (avisando en los logs) a que quede corriendo "seguro a
// medias" sin que nadie se entere. En Vercel: Project Settings → Environment Variables →
// JWT_SECRET (un valor largo y random, no el de local). En local: .env (ver .env.example).
const SECRET = (() => {
  const v = process.env.JWT_SECRET;
  if (!v) {
    throw new Error(
      "Falta la variable de entorno JWT_SECRET -- sin esto la app no puede firmar/verificar sesiones de forma segura. Configurala (Vercel: Project Settings → Environment Variables; local: .env) y volvé a desplegar/reiniciar."
    );
  }
  return v;
})();

export interface JwtPayload {
  userId: string;
  agentId: string;
  role: "AGENT" | "ADMIN" | "SUPERVISOR";
  email: string;
}

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autenticado" });
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Requiere rol admin" });
  next();
}
