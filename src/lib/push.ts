// Notificaciones push de TeamBack Affiliates (13/10/2026, pedido de Leo). Mismo criterio de
// "sección totalmente aparte" que el resto de TeamBack (ver lib/tbAuth.ts): usa sus propias
// variables de entorno (VAPID_*), nada compartido con el resto del sistema.
//
// Igual que TB_JWT_SECRET en lib/tbAuth.ts, el chequeo de las VAPID keys es PEREZOSO -- recién
// se evalúa cuando alguien intenta mandar un push de verdad, nunca al importar este módulo. Así,
// si todavía no se cargaron las env vars en Vercel, el resto de TeamBack Affiliates (y del
// sistema entero) sigue funcionando igual; solo falla la acción puntual de notificar.
import webpush from "web-push";

let configurado = false;
function asegurarConfigurado() {
  if (configurado) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "Faltan las variables de entorno VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT -- sin esto no se pueden mandar notificaciones push. Cargalas en Vercel (Project Settings → Environment Variables del proyecto backend) y volvé a desplegar."
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configurado = true;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  // Ruta dentro de la app a la que conviene llevar al usuario si toca la notificación (ver
  // sw.js, evento notificationclick). Por defecto "/" (el portal del jugador).
  url?: string;
  // URL de una imagen ya hosteada (13/10/2026, pedido de Leo) -- se muestra como imagen grande
  // dentro de la notificación en Android/Chrome (ver sw.js, campo "image" de
  // showNotification). No hay upload propio: tiene que ser un link a una imagen que ya exista
  // en algún lado.
  image?: string;
  // Número para el ícono de la app instalada (23/10/2026, pedido de Leo): avisos sin ver de ese usuario. Si no viene, el service worker
  // lleva su propia cuenta (ver sw.js).
  badge?: number;
}

/** Manda un push a UNA suscripción puntual. Si el navegador/SO la dio de baja del otro lado
 * (desinstaló la app, por ejemplo), web-push tira 404/410 -- eso lo interpreta el llamador
 * (sendPushATodasLasSuscripcionesDe) para limpiar la suscripción vieja de la base. */
export async function enviarPushAUnaSuscripcion(sub: PushSubscriptionInput, payload: PushPayload) {
  asegurarConfigurado();
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: sub.keys } as any,
    JSON.stringify(payload)
  );
}
