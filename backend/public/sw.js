// Prime Athl — Service Worker
const CACHE = 'prime-athl-v2';
const STATIC = ['/Muscu.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // API calls : réseau d'abord, pas de cache
  if (e.request.url.includes('/api/')) return;
  // Assets statiques : cache d'abord, réseau en fallback
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

// ── Push Notifications ───────────────────────────────
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
      data: { url: data.url || '/Muscu.html' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/Muscu.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/Muscu.html') && 'focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});
