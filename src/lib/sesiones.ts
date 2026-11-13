// Control de sesiones y de usuarios creados por otros (10/11/2026, pedido de Leo: "mejorar los logins a nivel seguridad, porque ahora
// se los estamos creando nosotros y los otros se lo crean al resto" -- puntos 1 y 4).
//
// 1) Cortar la sesión: el token dura 24h y antes no se volvía a mirar la base, así que un usuario desactivado o con la contraseña
//    cambiada seguía entrando hasta que vencía. Ahora cada pedido verifica que el usuario siga activo y que su token sea posterior a
//    agent_users.sesion_desde, que un trigger de la base pone en now() cada vez que cambia la contraseña, el estado o el rol (vale para
//    cualquier camino: admin, supervisor, agente, scripts).
// 2) Cascada: agent_users.created_by_user_id guarda quién creó cada usuario. Si quien lo creó (o el que creó a ese, etc.) está
//    desactivado, no entra. Los admins cortan la cadena: si se desactiva un admin, los usuarios que creó siguen funcionando. Además el
//    subagente no entra si la cuenta del agente dueño está desactivada.
//
// Se consulta la base con un caché corto por proceso (15 s) para no sumar una consulta por cada pedido.
import { pool, newId } from "../db/pool.js";
import { asegurarSchemaSubagentes } from "../repo/subagentes.js";
import { asegurarSchemaTesoreria } from "../repo/treasury.js";

let schemaListo: Promise<void> | null = null;
export function asegurarSchemaSesiones(): Promise<void> {
  schemaListo ??= (async () => {
    await asegurarSchemaSubagentes();
    await asegurarSchemaTesoreria();
    await pool.query(`
      ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS sesion_desde TIMESTAMPTZ;
      ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;
      -- Contraseña temporal (punto 2): los usuarios que ya existían quedan en false; los nuevos nacen en true (la eligió otro).
      ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE agent_users ALTER COLUMN must_change_password SET DEFAULT true;
      ALTER TABLE agent_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      -- Historial de cada usuario (punto 3): quién lo creó, le reseteó la contraseña, lo activó/desactivó o le cambió el rol.
      CREATE TABLE IF NOT EXISTS usuarios_historial (
        id                TEXT PRIMARY KEY,
        user_id           TEXT NOT NULL,
        accion            TEXT NOT NULL,
        hecho_por_user_id TEXT,
        detalle           TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_usuarios_historial ON usuarios_historial(user_id, created_at);
      CREATE OR REPLACE FUNCTION agent_users_sesion_desde() RETURNS trigger AS $f$
      BEGIN
        IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role THEN
          NEW.sesion_desde := now();
        END IF;
        RETURN NEW;
      END $f$ LANGUAGE plpgsql;`);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_agent_users_sesion_desde') THEN
          CREATE TRIGGER trg_agent_users_sesion_desde BEFORE UPDATE ON agent_users
            FOR EACH ROW EXECUTE FUNCTION agent_users_sesion_desde();
        END IF;
      END $$;`);
  })().catch((err) => {
    schemaListo = null;
    throw err;
  });
  return schemaListo;
}

export type EstadoAcceso =
  | { ok: true; sesionDesdeSeg: number | null }
  | { ok: false; motivo: "NO_EXISTE" | "DESACTIVADO" | "CREADOR_DESACTIVADO" | "CUENTA_DESACTIVADA" };

/** ¿Este usuario puede entrar? (activo, quien lo creó activo, y para un subagente, la cuenta del agente dueño activa). */
export async function estadoAcceso(userId: string): Promise<EstadoAcceso> {
  await asegurarSchemaSesiones();
  const r = await pool.query(
    `WITH RECURSIVE cadena AS (
       SELECT id, role, active, created_by_user_id, sesion_desde, subagente_id, 0 AS nivel FROM agent_users WHERE id = $1
       UNION ALL
       SELECT u.id, u.role, u.active, u.created_by_user_id, u.sesion_desde, u.subagente_id, c.nivel + 1
       FROM agent_users u JOIN cadena c ON u.id = c.created_by_user_id
       WHERE c.nivel < 6 AND (c.nivel = 0 OR c.role <> 'ADMIN')
     )
     SELECT
       (SELECT active FROM cadena WHERE nivel = 0) AS activo,
       (SELECT extract(epoch FROM sesion_desde) FROM cadena WHERE nivel = 0) AS sesion_desde,
       COALESCE(bool_and(active) FILTER (WHERE nivel > 0 AND role <> 'ADMIN'), true) AS creadores_activos,
       (SELECT a.active FROM cadena c JOIN agente_subagentes s ON s.id = c.subagente_id JOIN agents a ON a.id = s.agent_id
        WHERE c.nivel = 0 LIMIT 1) AS cuenta_duena_activa
     FROM cadena`,
    [userId]
  );
  const f = r.rows[0];
  if (!f || f.activo === null) return { ok: false, motivo: "NO_EXISTE" };
  if (f.activo === false) return { ok: false, motivo: "DESACTIVADO" };
  if (f.creadores_activos === false) return { ok: false, motivo: "CREADOR_DESACTIVADO" };
  if (f.cuenta_duena_activa === false) return { ok: false, motivo: "CUENTA_DESACTIVADA" };
  return { ok: true, sesionDesdeSeg: f.sesion_desde != null ? Math.floor(Number(f.sesion_desde)) : null };
}

export const MENSAJE_ACCESO: Record<string, string> = {
  NO_EXISTE: "Tu usuario ya no existe.",
  DESACTIVADO: "Este usuario está desactivado.",
  CREADOR_DESACTIVADO: "Tu acceso está suspendido: la cuenta que te dio el usuario está desactivada.",
  CUENTA_DESACTIVADA: "Tu acceso está suspendido: la cuenta de la que dependés está desactivada.",
  SESION_VIEJA: "Tu sesión se cerró porque cambió tu contraseña o tu acceso. Volvé a entrar.",
};

const cache = new Map<string, { estado: EstadoAcceso; hasta: number }>();
const TTL_MS = 15_000;

/** Igual que estadoAcceso pero con caché corto, para requireAuth. */
export async function estadoAccesoCacheado(userId: string): Promise<EstadoAcceso> {
  const ahora = Date.now();
  const c = cache.get(userId);
  if (c && c.hasta > ahora) return c.estado;
  const estado = await estadoAcceso(userId);
  cache.set(userId, { estado, hasta: ahora + TTL_MS });
  if (cache.size > 5000) cache.clear();
  return estado;
}

export type AccionHistorial = "CREADO" | "CLAVE_RESETEADA" | "CLAVE_ELEGIDA" | "ACTIVADO" | "DESACTIVADO" | "ROL_CAMBIADO";

/** Anota un evento en el historial del usuario. Nunca rompe la operación principal si falla. */
export async function registrarHistorial(
  db: { query: (q: string, v?: any[]) => Promise<any> },
  userId: string,
  accion: AccionHistorial,
  hechoPorUserId?: string | null,
  detalle?: string | null
) {
  try {
    await asegurarSchemaSesiones();
    await db.query(`INSERT INTO usuarios_historial (id, user_id, accion, hecho_por_user_id, detalle) VALUES ($1,$2,$3,$4,$5)`, [
      newId("uhist"),
      userId,
      accion,
      hechoPorUserId ?? null,
      detalle ?? null,
    ]);
  } catch (err) {
    console.error("No se pudo anotar el historial del usuario:", err);
  }
}

/** Reglas de la contraseña que elige el usuario (la temporal sigue pidiendo 6, la pone otro). */
export function problemaContrasena(nueva: string, usuario: string): string | null {
  if (nueva.length < 8) return "La contraseña tiene que tener al menos 8 caracteres.";
  if (nueva.trim().toLowerCase() === usuario.trim().toLowerCase()) return "La contraseña no puede ser igual a tu usuario.";
  return null;
}
