// Prime Athl — Service Worker
const CACHE = 'prime-athl-v9';

// ── Keep-alive : ping le serveur toutes les 10min pour éviter le cold start Render ──
const PING_INTERVAL = 10 * 60 * 1000;
let pingTimer = null;
function schedulePing() {
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = setTimeout(async () => {
    try { await fetch('/api/health'); } catch {}
    schedulePing();
  }, PING_INTERVAL);
}
// Ne jamais mettre Muscu.html/share.html en cache : ils changent à chaque deploy — sans ça,
// un utilisateur qui a l'app installée (PWA) et rouvre un ancien lien de partage reste bloqué
// sur la version de share.html mise en cache à sa première visite, indéfiniment (le cache-first
// ci-dessous ne revalide jamais, et la clé de cache inclut même le ?t=token donc chaque lien
// distinct se met en cache séparément).
const STATIC = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
const NEVER_CACHE_SUFFIXES = ['/Muscu.html', '/share.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  schedulePing();
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // API calls : réseau d'abord, pas de cache
  if (e.request.url.includes('/api/')) return;
  // Muscu.html / share.html : toujours réseau (jamais cache) pour avoir la dernière version.
  // On compare le pathname seul (pas l'URL complète) pour ignorer le ?t=token de share.html.
  const path = new URL(e.request.url).pathname;
  if (NEVER_CACHE_SUFFIXES.some(s => path === s)) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Autres assets statiques : cache d'abord, réseau en fallback
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
      icon: data.icon || '/push-icon.webp',
      badge: data.badge || '/icon-192.png',
      image: data.image || undefined,
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
