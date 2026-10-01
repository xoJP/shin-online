/* SHIN app worker — makes SHIN installable and playable offline.
   The game page is always fetched fresh from the server when there is internet (so every update on GitHub/Render
   reaches the installed app on its next start); only without internet the last saved copy starts.
   The online server (/api, WebSocket) is never cached. */
const CACHE = 'shin-app-v1';
const CORE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  const page = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (page) {                                   // newest first, the saved copy only when offline
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put('/', c)); } return r; })
      .catch(() => caches.match('/').then(r => r || caches.match(req))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); } return r; })));
});
