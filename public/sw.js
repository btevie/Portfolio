/* Overbill service worker: lets the app open offline. It only caches pages and static files from this same origin,
 * never anything you typed or uploaded (that lives in the browser's own storage, not in these caches). */
const VERSION = "overbill-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(["/dashboard"]).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first so you always see the latest, the cached copy when you are offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(req, copy)); } return res; })
        .catch(async () => (await caches.match(req)) || (await caches.match("/dashboard")) || new Response("You are offline, and this page has not been opened before.", { status: 503, headers: { "content-type": "text/plain" } })),
    );
    return;
  }

  // Built files, icons and the PDF reader: cache first, refreshed in the background.
  if (url.pathname.startsWith("/_next/static/") || /\.(?:png|svg|ico|woff2?|mjs|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        const refresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || refresh;
      }),
    );
  }
});
