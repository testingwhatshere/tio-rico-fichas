/* Service worker de TioRicoCargas: Web Push del equipo de soporte. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let body = 'Tenés un mensaje nuevo';
  let data = {};
  if (event.data) {
    try {
      const json = event.data.json();
      body = json.body || json.text || json.message || body;
      data = json.data || {};
    } catch (e) {
      body = event.data.text() || body;
    }
  }
  // Siempre mostrar el aviso: Safari revoca la suscripción si una push no muestra notificación.
  // El servidor ya no manda Web Push cuando la app está a la vista (evento `visibility`).
  event.waitUntil(
    Promise.resolve().then(() => {
      return self.registration.showNotification('Soporte', {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'soporte',
        renotify: true,
        data: Object.assign({ url: '/' }, data),
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL('/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          if ('navigate' in c && c.url !== url) c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
