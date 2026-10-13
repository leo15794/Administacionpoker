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

// Notificaciones push (13/10/2026, pedido de Leo) -- ver lib/push.ts (backend) y
// notifications.ts (frontend). El payload lo arma el backend como JSON ({title, body, url}),
// ver PushPayload en lib/push.ts.
self.addEventListener("push", (event) => {
  let data = { title: "TeamBack Affiliates", body: "Tenés una novedad.", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Si no vino como JSON válido, se muestra el genérico de arriba en vez de romper.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      // (13/10/2026, Leo probó en Android: el badge quedaba en blanco) -- el badge de Android
      // TIENE que ser una imagen de solo alfa (silueta blanca sobre transparente); si se le pasa
      // un ícono a color, como icon-192.png, Chrome no lo puede usar y lo deja vacío. Por eso va
      // un archivo aparte (badge-96.png), generado a partir del mismo logo pero como silueta.
      badge: "/badge-96.png",
      data: { url: data.url || "/" },
    })
  );
});

// Al tocar la notificación: si ya hay una pestaña/ventana de la app abierta, la enfoca; si no,
// abre una nueva en la URL que vino en el payload.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
