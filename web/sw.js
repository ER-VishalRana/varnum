// Keeps the app shell and its libraries cached so Varnum opens without internet.
// Translation itself still needs internet unless Chrome's on-device translator is available.
const CACHE = "varnum-v27";
const SHELL = [
  "./", "./index.html", "./auth.js?v=26", "./ui-hi.js?v=26", "./tools.js?v=26", "./sheet.js?v=26", "./manifest.webmanifest", "./logo.svg?v=26", "./favicon-32.png?v=26", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never cache translation or AI calls.
  if (/mymemory|generativelanguage/.test(u.hostname)) return;
  const isPage = e.request.mode === "navigate";
  if (isPage) {
    // Pages: try the network first so updates show up, fall back to the cached copy offline.
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || /cdnjs|fonts\.(googleapis|gstatic)/.test(u.hostname))) {
      const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c));
    }
    return r;
  })));
});
