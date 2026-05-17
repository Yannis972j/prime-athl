// Prime Athl — Service Worker (Push Notifications)
self.addEventListener('push', e => {
  let data = {};
  try { data = JSON.parse(e.data.text()); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Prime Athl', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'prime-athl',
      renotify: true,
      requireInteraction: false,
      data: { url: data.url || '/Muscu.html' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/Muscu.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Focus existing tab if already open
      for (const c of list) {
        if (c.url.includes('/Muscu.html') && 'focus' in c) {
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
