// Número en el ícono de la app instalada (23/10/2026, pedido de Leo): avisos sin ver. Usa la Badging API (Android, iPhone con la app en la
// pantalla de inicio, Chrome/Edge de PC); donde no existe no hace nada. Los portales cuentan los avisos sin leer de la bandeja; TeamBack
// cuenta los avisos recibidos desde la última vez que se abrió la app (el service worker lleva esa cuenta en un caché, ver sw.js).

const CACHE_CONTADOR = "dp-badge-v1";

type NavConBadge = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function setBadge(n: number) {
  try {
    const nav = navigator as NavConBadge;
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  } catch {
    // sin soporte o sin permiso: no pasa nada, el aviso igual se ve en la bandeja
  }
}

/** Borra el número y la cuenta que lleva el service worker (para TeamBack, que no tiene bandeja con "leídos"). */
export function clearBadge() {
  setBadge(0);
  try {
    if ("caches" in window) caches.delete(CACHE_CONTADOR).catch(() => {});
  } catch {
    // idem
  }
}
