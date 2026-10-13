// Instalar como app (13/10/2026, pedido de Leo para TeamBack Affiliates, ver mockup que
// aprobó). El evento "beforeinstallprompt" (Chrome/Android/Edge) puede dispararse MUY
// temprano, antes de que React monte nada -- si un componente recién empieza a escucharlo en
// su propio useEffect, puede perdérselo para siempre. Por eso este módulo lo captura apenas se
// importa (desde main.tsx, al arrancar la app) y lo guarda en una variable de módulo; cualquier
// componente que lo necesite después (el banner de instalar) lo puede leer con
// getInstallPromptEvent() u observar cambios con onInstallPromptChange(). Safari/iOS NUNCA
// dispara este evento -- ahí el banner usa instrucciones manuales (ver TeamBackAffiliates.tsx).
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let capturedEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

function notify() {
  listeners.forEach((l) => l(capturedEvent));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    capturedEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  // Ya instalada (o el usuario la instaló recién) -- no tiene sentido seguir ofreciendo el banner.
  window.addEventListener("appinstalled", () => {
    capturedEvent = null;
    notify();
  });
}

export function getInstallPromptEvent(): BeforeInstallPromptEvent | null {
  return capturedEvent;
}

export function onInstallPromptChange(cb: (e: BeforeInstallPromptEvent | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari: no tiene "display-mode: standalone", usa esta propiedad propia.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !("MSStream" in window);
}
