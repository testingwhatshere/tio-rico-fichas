/* Service worker de TioRicoCargas Equipo: Web Push de mensajes nuevos y esperas. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let title = 'TioRicoCargas Equipo';
  let body = 'Mensaje nuevo';
  let data = {};
  if (event.data) {
    try {
      const json = event.data.json();
      title = json.title || title;
      body = json.body || body;
      data = json.data || {};
    } catch (e) {
      body = event.data.text() || body;
    }
  }
  // Siempre mostrar el aviso: Safari revoca la suscripción si una push no muestra notificación.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.userId ? 'chat-' + data.userId : 'equipo',
      renotify: true,
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const userId = event.notification.data && event.notification.data.userId;
  const url = new URL(userId ? '/chat/' + userId : '/', self.location.origin).href;
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
