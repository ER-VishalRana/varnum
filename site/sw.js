// The web app moved from / to /app/. This replaces the old service worker that was registered at the
// site root: it clears its caches and removes itself, so the product website is always loaded fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: "window" })) c.navigate(c.url);
  })());
});
