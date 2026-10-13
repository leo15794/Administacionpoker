// Service worker mínimo (13/10/2026, pedido de Leo: botón de instalar app en TeamBack
// Affiliates) -- sin un service worker registrado, Chrome/Android no considera "instalable"
// al sitio y nunca dispara "beforeinstallprompt". No busca funcionamiento offline ni cachea
// nada propio: solo deja pasar cada request tal cual a la red (al no llamar
// event.respondWith(), el navegador lo maneja como si no hubiera service worker).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // no-op a propósito: sin cache propio, todo sigue yendo a la red como siempre.
});
