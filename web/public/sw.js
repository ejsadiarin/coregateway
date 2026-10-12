// Minimal service worker: offline app shell, network-only API.
// Bump VERSION to force clients onto fresh assets.
const VERSION = "core-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return; // auth API: never cache
  event.respondWith(
    caches.match(event.request).then((hit) => {
      const net = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
