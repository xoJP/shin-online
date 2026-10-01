/* SHIN app worker — switched off (JP doesn't want the installable app).
   Any browser that still has the old worker picks this one up, deletes the saved copies and removes itself. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))))
    .then(() => self.registration.unregister())
    .then(() => self.clients.matchAll({ type: 'window' }))
    .then(cs => cs.forEach(c => { try { c.navigate(c.url); } catch (e) {} })));
});
