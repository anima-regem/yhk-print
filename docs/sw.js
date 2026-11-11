const prefix = "yhk-print-";
const cacheName = prefix + "v4";
const files = [
  "./", "./index.html", "./style.css", "./app.js", "./raster.js", "./bluetooth.js",
  "./instrument-sans.woff2", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(files)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = "./" + url.pathname.slice(scope.pathname.length);
  if (!files.includes(path)) return;

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    if (request.mode === "navigate") {
      return fetch(request).catch(() => cache.match("./index.html"));
    }
    return await cache.match(path) || fetch(request);
  })());
});
