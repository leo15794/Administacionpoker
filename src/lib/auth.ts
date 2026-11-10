import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { estadoAccesoCacheado, MENSAJE_ACCESO } from "./sesiones.js";

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
  // Nullable (16/10/2026, rol PROVEEDOR): un login de proveedor no cuelga de ningún agente --
  // ver proveedorId abajo. Para cualquier otro role sigue viniendo siempre seteado.
  agentId: string | null;
  role: "AGENT" | "ADMIN" | "SUPERVISOR" | "PROVEEDOR" | "SOCIO" | "SUBAGENTE";
  email: string;
  // Solo seteado cuando role === "PROVEEDOR" (16/10/2026) -- ver src/routes/auth.ts (login) y
  // src/routes/portal.ts (GET /mi-proveedor, que SOLO confía en este campo del token, nunca en
  // nada que mande el cliente).
  proveedorId?: string | null;
  // Solo seteado cuando role === "SOCIO" (27/10/2026): la cuenta de socio (partner_accounts) que ve este login. Mismo criterio que proveedorId: el portal solo confía en el token.
  partnerAccountId?: string | null;
  // Solo seteado cuando role === "SUBAGENTE" (10/11/2026): el subagente (agente_subagentes) que ve este login. agentId queda NULL,
  // así el subagente nunca puede ver la cuenta del agente. Ver repo/subagentes.ts y GET /portal/mi-subagente.
  subagenteId?: string | null;
  // (10/11/2026, punto 2) Entró con una contraseña temporal: hasta elegir la suya solo puede llamar a /auth/cambiar-clave.
  cambiarClave?: boolean;
}

// (07/10/2026, pedido de Leo: "no quede abierto eterno") -- antes duraba 7 dias. Lo
// acortamos a 24hs: combinado con el cierre de sesion por inactividad del frontend
// (ver web/src/components/IdleGuard.tsx), asi alguien que minimiza el navegador y
// vuelve al otro dia tiene que loguearse de nuevo si o si, aunque el token en
// localStorage siga ahi.
export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export interface AuthedRequest extends Request {
  user?: JwtPayload & { iat?: number };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No autenticado" });
  let payload: JwtPayload & { iat?: number };
  try {
    payload = verifyToken(header.slice(7)) as JwtPayload & { iat?: number };
  } catch {
    return res.status(401).json({ error: "Token inválido o vencido", code: "SESION_VENCIDA" });
  }
  // (10/11/2026) El token solo no alcanza: si al usuario lo desactivaron, le cambiaron la contraseña o el rol, o se desactivó quien
  // lo creó, la sesión se corta en el próximo pedido (ver lib/sesiones.ts).
  estadoAccesoCacheado(payload.userId)
    .then((estado) => {
      if (!estado.ok) return res.status(401).json({ error: MENSAJE_ACCESO[estado.motivo], code: "SESION_CORTADA" });
      if (estado.sesionDesdeSeg !== null && (payload.iat ?? 0) < estado.sesionDesdeSeg) {
        return res.status(401).json({ error: MENSAJE_ACCESO.SESION_VIEJA, code: "SESION_CORTADA" });
      }
      if (payload.cambiarClave && !req.originalUrl.includes("/auth/cambiar-clave")) {
        return res.status(403).json({ error: "Antes de seguir tenés que elegir tu contraseña.", code: "CAMBIAR_CLAVE" });
      }
      req.user = payload;
      next();
    })
    .catch((err) => {
      console.error("Error validando la sesión:", err);
      res.status(503).json({ error: "No se pudo validar tu sesión. Probá de nuevo en un momento." });
    });
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Requiere rol admin" });
  next();
}
