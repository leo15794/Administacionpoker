// "Olvidé mi contraseña" (10/11/2026, pedido de Leo, mockup 89). No hay mails reales (los usuarios son nombres), así que el pedido le
// llega a quien puede resetearle la contraseña a esa persona:
//   - subagente  -> el agente dueño (Mis subagentes)
//   - agente con supervisor -> su supervisor (Mis agentes)
//   - cualquiera -> los admins (Usuarios y permisos), que ven todos los pedidos
// Quien lo resuelve genera una contraseña temporal con un clic (se muestra una sola vez para pasársela); al entrar, la persona elige la
// suya (ver lib/sesiones.ts, must_change_password). Desde el login nunca se revela si el usuario existe.
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { pool, newId } from "../db/pool.js";
import { asegurarSchemaSesiones, registrarHistorial } from "../lib/sesiones.js";
import { enviarPushAUnaSuscripcion } from "../lib/push.js";

let schemaListo: Promise<void> | null = null;
function asegurarSchema(): Promise<void> {
  schemaListo ??= (async () => {
    await asegurarSchemaSesiones();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos_clave (
        id             TEXT PRIMARY KEY,
        user_id        TEXT NOT NULL,
        estado         TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','RESUELTO','IGNORADO')),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        resuelto_por   TEXT,
        resuelto_at    TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_pedidos_clave_estado ON pedidos_clave(estado, created_at);`);
  })().catch((err) => {
    schemaListo = null;
    throw err;
  });
  return schemaListo;
}

// Quién puede resolver el pedido de un usuario (logins de agent_users).
async function resolutores(userId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT DISTINCT r.id FROM agent_users u
     LEFT JOIN agente_subagentes sub ON sub.id = u.subagente_id
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN agents s ON s.name = a.supervisor AND s.id <> a.id
     JOIN agent_users r ON r.active = true AND (
       (u.role = 'SUBAGENTE' AND r.role = 'AGENT' AND r.agent_id = sub.agent_id)
       OR (u.role = 'AGENT' AND r.role = 'SUPERVISOR' AND r.agent_id = s.id)
     )
     WHERE u.id = $1`,
    [userId]
  );
  return r.rows.map((x) => x.id);
}

const RUTA: Record<string, string> = { AGENT: "/mi-cuenta/subagentes", SUPERVISOR: "/mi-supervision/agentes", ADMIN: "/dashboard/usuarios" };

async function avisar(userIds: string[], nombre: string) {
  if (userIds.length === 0) return;
  const r = await pool.query(
    `SELECT s.endpoint, s.p256dh, s.auth, u.role FROM push_subs s JOIN agent_users u ON u.id = s.user_id WHERE s.user_id = ANY($1::text[])`,
    [userIds]
  );
  for (const s of r.rows) {
    try {
      await enviarPushAUnaSuscripcion(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title: `${nombre} pidió una contraseña nueva`, body: "Tocá para generarle una contraseña temporal.", url: RUTA[s.role] ?? "/" }
      );
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) await pool.query(`DELETE FROM push_subs WHERE endpoint = $1`, [s.endpoint]);
    }
  }
}

/** Desde el login. Nunca dice si el usuario existe: el que llama siempre recibe la misma respuesta. */
export async function pedirClave(usuario: string) {
  await asegurarSchema();
  const u = (await pool.query(`SELECT id, email, active FROM agent_users WHERE lower(email) = lower($1) LIMIT 1`, [usuario.trim()])).rows[0];
  if (!u || u.active === false) return;
  // Un pedido pendiente por usuario: si ya hay uno de la última hora, no se vuelve a avisar.
  const ya = await pool.query(
    `SELECT 1 FROM pedidos_clave WHERE user_id = $1 AND estado = 'PENDIENTE' AND created_at > now() - interval '1 hour'`,
    [u.id]
  );
  if (ya.rows[0]) return;
  await pool.query(`INSERT INTO pedidos_clave (id, user_id) VALUES ($1,$2)`, [newId("pclave"), u.id]);
  const quienes = await resolutores(u.id);
  if (quienes.length > 0) await avisar(quienes, u.email);
  else {
    const admins = (await pool.query(`SELECT id FROM agent_users WHERE role = 'ADMIN' AND active = true`)).rows.map((x) => x.id);
    await avisar(admins, u.email);
  }
}

type Quien = { userId: string; role: string; agentId: string | null };

// Filtro SQL de los pedidos que puede ver/resolver quien llama ($1 = su agentId).
function filtro(q: Quien): string | null {
  if (q.role === "ADMIN") return "true";
  if (q.role === "SUPERVISOR")
    return `(u.role = 'AGENT' AND a.active = true AND a.supervisor = (SELECT name FROM agents WHERE id = $1) AND a.id <> $1)`;
  if (q.role === "AGENT") return `(u.role = 'SUBAGENTE' AND sub.agent_id = $1)`;
  return null;
}

/** Pedidos pendientes que le tocan a quien llama. */
export async function pedidosPendientes(q: Quien) {
  await asegurarSchema();
  const f = filtro(q);
  if (!f) return [];
  const r = await pool.query(
    `SELECT DISTINCT ON (p.user_id) p.id, p.user_id, p.created_at, u.email AS usuario, u.role,
            COALESCE(sub.name, a.name) AS cuenta
     FROM pedidos_clave p
     JOIN agent_users u ON u.id = p.user_id
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN agente_subagentes sub ON sub.id = u.subagente_id
     WHERE p.estado = 'PENDIENTE' AND u.active = true AND ${f}
     ORDER BY p.user_id, p.created_at DESC`,
    q.role === "ADMIN" ? [] : [q.agentId]
  );
  return r.rows.sort((x, y) => +new Date(y.created_at) - +new Date(x.created_at));
}

async function pedidoPermitido(q: Quien, pedidoId: string) {
  const f = filtro(q);
  if (!f) throw new Error("No podés resolver este pedido.");
  const params = q.role === "ADMIN" ? [pedidoId] : [q.agentId, pedidoId];
  const r = await pool.query(
    `SELECT p.id, p.user_id, u.email FROM pedidos_clave p
     JOIN agent_users u ON u.id = p.user_id
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN agente_subagentes sub ON sub.id = u.subagente_id
     WHERE p.id = $${params.length} AND p.estado = 'PENDIENTE' AND ${f}`,
    params
  );
  if (!r.rows[0]) throw new Error("Ese pedido ya no está pendiente o no te corresponde.");
  return r.rows[0];
}

const PALABRAS = ["mesa", "ficha", "tigre", "rio", "sol", "luna", "carta", "pampa", "nube", "faro", "lobo", "trebol", "piedra", "mate", "puerto", "monte", "rayo", "viento"];
function claveTemporal() {
  const p = () => PALABRAS[randomInt(PALABRAS.length)];
  return `${p()}-${randomInt(10, 100)}-${p()}`;
}

/** Genera la contraseña temporal (se devuelve una sola vez). Corta las sesiones abiertas de esa persona (trigger de lib/sesiones.ts). */
export async function resolverPedido(q: Quien, pedidoId: string) {
  await asegurarSchema();
  const p = await pedidoPermitido(q, pedidoId);
  const clave = claveTemporal();
  await pool.query(`UPDATE agent_users SET password_hash = $1, must_change_password = true WHERE id = $2`, [await bcrypt.hash(clave, 10), p.user_id]);
  await pool.query(
    `UPDATE pedidos_clave SET estado = 'RESUELTO', resuelto_por = $1, resuelto_at = now() WHERE user_id = $2 AND estado = 'PENDIENTE'`,
    [q.userId, p.user_id]
  );
  await registrarHistorial(pool, p.user_id, "CLAVE_RESETEADA", q.userId, "pedido desde Olvidé mi contraseña");
  return { usuario: p.email, clave };
}

export async function ignorarPedido(q: Quien, pedidoId: string) {
  await asegurarSchema();
  const p = await pedidoPermitido(q, pedidoId);
  await pool.query(
    `UPDATE pedidos_clave SET estado = 'IGNORADO', resuelto_por = $1, resuelto_at = now() WHERE user_id = $2 AND estado = 'PENDIENTE'`,
    [q.userId, p.user_id]
  );
  return { ok: true };
}
