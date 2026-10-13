// Notificaciones push (13/10/2026, pedido de Leo, TeamBack Affiliates) -- ver lib/push.ts
// (backend) y sw.js (evento 'push'). Solo tiene sentido en Android/Chrome/Edge/desktop Chrome
// y, en iOS, SOLO si la app ya está instalada en la pantalla de inicio (requisito de Apple,
// Safari normal nunca deja activar push) -- ver isIos()/isStandaloneDisplay() en
// installPrompt.ts, que el banner de acá reusa para decidir qué mostrar.
import { api } from "./api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

// El navegador espera la clave pública VAPID como Uint8Array, no como el string base64url que
// da el backend -- esta conversión es la estándar (la misma que aparece en cualquier ejemplo de
// Web Push, no hay vuelta que darle).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && !!VAPID_PUBLIC_KEY;
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/** true si este navegador ya tiene una suscripción push activa (no implica que el permiso siga
 * siendo "granted" del lado del SO -- eso se chequea aparte con getNotificationPermission()). */
export async function yaEstaSuscripto(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}

/** Pide permiso de notificaciones y, si lo dan, suscribe este navegador y manda la suscripción
 * al backend. Devuelve el resultado para que el banner pueda mostrar el mensaje justo (aceptó /
 * rechazó / no soportado). */
export async function activarNotificaciones(): Promise<"ok" | "denegado" | "no-soportado"> {
  if (!isPushSupported()) return "no-soportado";
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") return "denegado";

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
    });
  }
  const json = sub.toJSON();
  await api.teamback.push.subscribe({
    endpoint: json.endpoint!,
    keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth },
  });
  return "ok";
}

export async function desactivarNotificaciones(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.teamback.push.unsubscribe(endpoint);
}
