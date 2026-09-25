// TeamBack Affiliates V1 (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y
// contraseña para esta seccion") -- auth TOTALMENTE APARTE del resto del sistema (lib/auth.ts).
// Mismo criterio de seguridad (secreto obligatorio, sin fallback inseguro -- ver el comentario
// en lib/auth.ts del análisis de seguridad del 24/09), pero con su PROPIO secreto: un token
// firmado acá nunca es válido contra lib/auth.ts, y viceversa -- son dos sistemas de login
// completamente independientes, a propósito.
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = (() => {
  const v = process.env.TB_JWT_SECRET;
  if (!v) {
    throw new Error(
      "Falta la variable de entorno TB_JWT_SECRET -- sin esto la sección TeamBack Affiliates no puede firmar/verificar sesiones de forma segura. Configurala (Vercel: Project Settings → Environment Variables; local: .env) y volvé a desplegar/reiniciar. Tiene que ser DISTINTA de JWT_SECRET."
    );
  }
  return v;
})();

export interface TbJwtPayload {
  userId: string;
  role: "ADMIN" | "PLAYER";
  email: string;
  // Solo presente cuando role === "PLAYER" -- el jugador al que este login le pertenece.
  playerId: string | null;
}

export function signTbToken(payload: TbJwtPayload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyTbToken(token: string): TbJwtPayload {
  return jwt.verify(token, SECRET) as TbJwtPayload;
}

export interface TbAuthedRequest extends Request {
  tbUser?: TbJwtPayload;
}

export function requireTbAuth(req: TbAuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autenticado" });
  try {
    req.tbUser = verifyTbToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido" });
  }
}

export function requireTbAdmin(req: TbAuthedRequest, res: Response, next: NextFunction) {
  if (req.tbUser?.role !== "ADMIN") return res.status(403).json({ error: "Requiere rol admin de TeamBack Affiliates" });
  next();
}

export function requireTbPlayer(req: TbAuthedRequest, res: Response, next: NextFunction) {
  if (req.tbUser?.role !== "PLAYER" || !req.tbUser.playerId) return res.status(403).json({ error: "Requiere login de jugador" });
  next();
}
