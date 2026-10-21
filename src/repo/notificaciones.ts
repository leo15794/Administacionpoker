// Avisos push de supervisores, proveedores y agentes (21/10/2026, pedido de Leo). SIEMPRE manuales: nada acá se
// dispara solo, el admin elige a quién mandar desde el panel Avisos. Usa la misma infraestructura
// que TeamBack (lib/push.ts, VAPID, sw.js) pero con sus propias tablas, ligadas al login (agent_users).
// Cada aviso puede llevar hasta 10 imágenes (guardadas en la base) y queda en la bandeja de cada destinatario, así
// lo ven (y descargan las imágenes) aunque no hayan activado las notificaciones.
import { createHmac } from "node:crypto";
import { pool, newId } from "../db/pool.js";
import { enviarPushAUnaSuscripcion } from "../lib/push.js";

export const MAX_IMAGENES_POR_AVISO = 10;
export const MAX_BYTES_IMAGEN = 4 * 1024 * 1024;
export const MIMES_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function guardarSuscripcion(
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string | null
) {
  await pool.query(
    `INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [newId("pushsub"), userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null]
  );
}

export async function eliminarSuscripcion(userId: string, endpoint: string) {
  await pool.query(`DELETE FROM push_subs WHERE endpoint = $1 AND user_id = $2`, [endpoint, userId]);
}

export async function cantidadSuscripciones(userId: string): Promise<number> {
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM push_subs WHERE user_id = $1`, [userId]);
  return r.rows[0].n;
}

/** Logins a los que se les puede mandar un aviso (activos, de agente, supervisor o proveedor), con cuántos dispositivos tienen activados. */
export async function listarDestinatarios() {
  const r = await pool.query(
    `SELECT u.id, u.email, u.role,
            COALESCE(p.name, a.name, u.email) AS nombre,
            (SELECT COUNT(*)::int FROM push_subs s WHERE s.user_id = u.id) AS dispositivos
     FROM agent_users u
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN proveedores p ON p.id = u.proveedor_id
     WHERE u.active = TRUE AND u.role IN ('AGENT','SUPERVISOR','PROVEEDOR')
     ORDER BY u.role, nombre`
  );
  return r.rows;
}

// ---- Imágenes de los avisos ----

export async function guardarImagen(input: { nombre: string; mime: string; datos: Buffer; actor?: string | null }) {
  if (!MIMES_IMAGEN.includes(input.mime)) throw new Error("Solo se aceptan imágenes JPG, PNG, WEBP o GIF.");
  if (input.datos.length === 0) throw new Error("La imagen llegó vacía.");
  if (input.datos.length > MAX_BYTES_IMAGEN) throw new Error("La imagen pesa más de 4 MB.");
  const id = newId("aviimg");
  await pool.query(
    `INSERT INTO aviso_imagenes (id, nombre, mime, size, datos, creado_por) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, input.nombre.slice(0, 120) || "imagen", input.mime, input.datos.length, input.datos, input.actor ?? null]
  );
  return { id, nombre: input.nombre.slice(0, 120) || "imagen", size: input.datos.length };
}

export async function obtenerImagen(id: string) {
  const r = await pool.query(`SELECT id, nombre, mime, size, datos FROM aviso_imagenes WHERE id = $1`, [id]);
  return r.rows[0] ?? null;
}

/** Un destinatario solo puede ver/descargar las imágenes de avisos que se le enviaron a él. */
export async function destinatarioPuedeVerImagen(userId: string, imagenId: string) {
  const r = await pool.query(
    `SELECT 1 FROM aviso_destinatarios d JOIN push_envios_log l ON l.id = d.aviso_id
     WHERE d.user_id = $1 AND l.imagenes @> $2::jsonb LIMIT 1`,
    [userId, JSON.stringify([{ id: imagenId }])]
  );
  return r.rows.length > 0;
}

// Firma para el link público que usa la notificación del celular (el sistema operativo baja la imagen sin sesión): sin la firma no se accede.
function secreto() {
  return process.env.JWT_SECRET || "";
}
export function firmarImagen(id: string) {
  return createHmac("sha256", secreto()).update(`aviso-imagen:${id}`).digest("hex").slice(0, 32);
}
export function firmaValida(id: string, firma: string) {
  return !!secreto() && firma === firmarImagen(id);
}

const RUTA_POR_ROL: Record<string, string> = {
  AGENT: "/mi-cuenta",
  SUPERVISOR: "/mi-supervision",
  PROVEEDOR: "/mi-proveedor",
};

/** Manda el aviso SOLO a los logins elegidos. Al tocar la notificación abre el portal de cada uno. Las suscripciones
 * que el navegador ya dio de baja (404/410) se borran. El aviso queda en la bandeja de TODOS los elegidos (con o sin
 * notificaciones activadas). Devuelve quiénes lo recibieron como notificación y quiénes no tenían nada activado. */
export async function enviarAvisos(input: {
  userIds: string[];
  titulo: string;
  mensaje: string;
  imagenIds?: string[];
  baseUrl: string;
  actor?: string | null;
}) {
  const usuarios = await pool.query(
    `SELECT u.id, u.role, COALESCE(p.name, a.name, u.email) AS nombre
     FROM agent_users u
     LEFT JOIN agents a ON a.id = u.agent_id
     LEFT JOIN proveedores p ON p.id = u.proveedor_id
     WHERE u.id = ANY($1::text[]) AND u.active = TRUE AND u.role IN ('AGENT','SUPERVISOR','PROVEEDOR')`,
    [input.userIds]
  );
  const idsImg = [...new Set(input.imagenIds ?? [])].slice(0, MAX_IMAGENES_POR_AVISO);
  let imagenes: { id: string; nombre: string; size: number }[] = [];
  if (idsImg.length > 0) {
    const r = await pool.query(`SELECT id, nombre, size FROM aviso_imagenes WHERE id = ANY($1::text[])`, [idsImg]);
    // se respeta el orden en que las eligió el admin (la primera es la que se ve grande en la notificación)
    imagenes = idsImg.map((id) => r.rows.find((x) => x.id === id)).filter(Boolean) as any;
    if (imagenes.length !== idsImg.length) throw new Error("Alguna imagen ya no existe. Volvé a adjuntarla.");
  }
  const urlImagen = imagenes[0] ? `${input.baseUrl}/notificaciones/publica/${imagenes[0].id}/${firmarImagen(imagenes[0].id)}` : undefined;

  let entregados = 0;
  const sinActivar: { id: string; nombre: string }[] = [];
  const recibieron: { id: string; nombre: string }[] = [];
  for (const u of usuarios.rows) {
    const subs = await pool.query(`SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = $1`, [u.id]);
    let ok = 0;
    for (const s of subs.rows) {
      try {
        await enviarPushAUnaSuscripcion(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          { title: input.titulo, body: input.mensaje, url: RUTA_POR_ROL[u.role] ?? "/", image: urlImagen }
        );
        ok++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await pool.query(`DELETE FROM push_subs WHERE endpoint = $1`, [s.endpoint]);
        }
        // Cualquier otro error de red se ignora para esta suscripción: no frena al resto.
      }
    }
    if (ok > 0) {
      entregados++;
      recibieron.push({ id: u.id, nombre: u.nombre });
    } else {
      sinActivar.push({ id: u.id, nombre: u.nombre });
    }
  }
  const avisoId = newId("pushlog");
  await pool.query(
    `INSERT INTO push_envios_log (id, titulo, mensaje, elegidos, entregados, sin_activar, actor, imagenes)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
    [avisoId, input.titulo, input.mensaje, usuarios.rows.length, entregados, JSON.stringify(sinActivar), input.actor ?? null, JSON.stringify(imagenes)]
  );
  if (usuarios.rows.length > 0) {
    await pool.query(
      `INSERT INTO aviso_destinatarios (aviso_id, user_id) SELECT $1, x FROM unnest($2::text[]) AS x ON CONFLICT DO NOTHING`,
      [avisoId, usuarios.rows.map((u) => u.id)]
    );
  }
  return { elegidos: usuarios.rows.length, entregados, recibieron, sinActivar, imagenes: imagenes.length };
}

export async function listarHistorial() {
  const r = await pool.query(`SELECT * FROM push_envios_log ORDER BY created_at DESC LIMIT 100`);
  return r.rows;
}

// ---- Bandeja de avisos de cada portal ----

export async function bandeja(userId: string) {
  const r = await pool.query(
    `SELECT l.id, l.titulo, l.mensaje, l.imagenes, l.created_at, d.leido_at
     FROM aviso_destinatarios d JOIN push_envios_log l ON l.id = d.aviso_id
     WHERE d.user_id = $1 ORDER BY l.created_at DESC LIMIT 30`,
    [userId]
  );
  return r.rows;
}

export async function marcarLeidos(userId: string, avisoIds: string[]) {
  if (avisoIds.length === 0) return;
  await pool.query(
    `UPDATE aviso_destinatarios SET leido_at = now() WHERE user_id = $1 AND aviso_id = ANY($2::text[]) AND leido_at IS NULL`,
    [userId, avisoIds]
  );
}
