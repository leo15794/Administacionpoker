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
  let data = { title: "TeamBack Affiliates", body: "Tenés una novedad.", url: "/teamback", image: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Si no vino como JSON válido, se muestra el genérico de arriba en vez de romper.
  }
  event.waitUntil(
    Promise.all([actualizarNumeroDelIcono(data.badge), self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      // Imagen grande opcional (13/10/2026, pedido de Leo) -- si el payload no trae "image",
      // queda undefined y el navegador simplemente no muestra ninguna.
      image: data.image,
      // (13/10/2026, Leo probó en Android: el badge quedaba en blanco) -- el badge de Android
      // TIENE que ser una imagen de solo alfa (silueta blanca sobre transparente); si se le pasa
      // un ícono a color, como icon-192.png, Chrome no lo puede usar y lo deja vacío. Por eso va
      // un archivo aparte (badge-96.png), generado a partir del mismo logo pero como silueta.
      badge: "/badge-96.png",
      data: { url: data.url || "/teamback" },
    })])
  );
});

// Si el navegador renueva la suscripción (30/10/2026, pedido de Leo), se vuelve a crear acá. El service worker no tiene sesión: el backend la
// recibe la próxima vez que se abre la app (ver sincronizarSuscripcion en notifications.ts).
self.addEventListener("pushsubscriptionchange", (event) => {
  const clave = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
  if (!clave) return;
  event.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave }));
});

// Número en el ícono de la app instalada (23/10/2026, pedido de Leo). Si el aviso trae el número (portales: avisos sin leer, lo calcula el
// servidor) se usa tal cual; si no (TeamBack), se suma uno a una cuenta guardada en un caché, que la app borra al abrirse (ver badge.ts).
const CACHE_CONTADOR = "dp-badge-v1";
async function actualizarNumeroDelIcono(desdeServidor) {
  try {
    let n = Number(desdeServidor);
    if (!Number.isFinite(n) || n <= 0) {
      const cache = await caches.open(CACHE_CONTADOR);
      const previo = await cache.match("/__contador");
      n = (previo ? Number(await previo.text()) || 0 : 0) + 1;
      await cache.put("/__contador", new Response(String(n)));
    }
    if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
  } catch {
    // sin soporte o sin permiso: el aviso se muestra igual
  }
}

// Al tocar la notificación: si ya hay una pestaña/ventana de la app abierta, la enfoca; si no,
// abre una nueva en la URL que vino en el payload.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/teamback";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          // (13/10/2026, Leo reportó: "cuando hago click me lleva al poker administracion y no
          // al de afiliados") -- antes esto solo hacía focus() de la primera ventana abierta,
          // SIN importar en qué sección de la app estaba -- si ya tenías el admin principal
          // abierto en otra pestaña, el click en la notificación de TeamBack solo la enfocaba
          // tal cual estaba, en vez de llevarte a /teamback. Ahora, si esa ventana no está ya
          // en la url del aviso, primero la navega ahí.
          if ("navigate" in client && typeof client.url === "string" && !client.url.includes(url)) {
            return client.navigate(url).then((c) => (c ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
