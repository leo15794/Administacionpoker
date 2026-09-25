// TeamBack Affiliates V1 (25/09/2026, pedido de Leo: "necesito que hagamos usuarios y
// contraseña para esta seccion") -- auth TOTALMENTE APARTE del resto del sistema (lib/auth.ts).
// Mismo criterio de seguridad (secreto obligatorio, sin fallback inseguro -- ver el comentario
// en lib/auth.ts del análisis de seguridad del 24/09), pero con su PROPIO secreto: un token
// firmado acá nunca es válido contra lib/auth.ts, y viceversa -- son dos sistemas de login
// completamente independientes, a propósito.
//
// (25/09/2026, bug reportado por Leo: "Failed to fetch" en TODA la app, incluido Resumen, que
// no tiene nada que ver con TeamBack Affiliates) -- ANTES el chequeo de TB_JWT_SECRET corría en
// un IIFE al nivel del módulo, apenas se importaba este archivo. Como app.ts importa
// routes/teamback.ts (que importa este archivo) para TODOS los requests, si faltaba
// TB_JWT_SECRET en el entorno el proceso entero tiraba una excepción al arrancar -- rompiendo
// TAMBIÉN el resto de la app (Resumen, Agentes, todo), no solo esta sección. Justo lo contrario
// de "sección totalmente aparte". Ahora el chequeo es PEREZOSO: solo se evalúa cuando alguien
// de verdad intenta firmar o verificar un token de esta sección -- si falta la variable, se
// rompe SOLO esa acción puntual (login o cualquier request a /teamback/*), el resto de
// DigiPlayers sigue funcionando igual.
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

function getSecret(): string {
  const v = process.env.TB_JWT_SECRET;
  if (!v) {
    throw new Error(
      "Falta la variable de entorno TB_JWT_SECRET -- sin esto la sección TeamBack Affiliates no puede firmar/verificar sesiones de forma segura. Configurala (Vercel: Project Settings → Environment Variables; local: .env) y volvé a desplegar/reiniciar. Tiene que ser DISTINTA de JWT_SECRET."
    );
  }
  return v;
}

export interface TbJwtPayload {
  userId: string;
  role: "ADMIN" | "PLAYER";
  // (25/09/2026, pedido de Leo: "no sea obligacion el email, puede ser usuario y contraseña")
  // -- login por USUARIO, cualquier texto, no un email.
  username: string;
  // Solo presente cuando role === "PLAYER" -- el jugador al que este login le pertenece.
  playerId: string | null;
}

export function signTbToken(payload: TbJwtPayload) {
  return jwt.sign(payload, getSecret(), { expiresIn: "7d" });
}

export function verifyTbToken(token: string): TbJwtPayload {
  return jwt.verify(token, getSecret()) as TbJwtPayload;
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
  } catch (err: any) {
    // Si el problema es que falta TB_JWT_SECRET en el servidor, avisarlo distinto de "token
    // vencido" -- si no, parece un problema del usuario cuando en realidad falta configurar algo.
    if (String(err?.message).includes("TB_JWT_SECRET")) {
      console.error(err.message);
      return res.status(500).json({ error: "TeamBack Affiliates no está configurado del lado del servidor (falta TB_JWT_SECRET)." });
    }
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
