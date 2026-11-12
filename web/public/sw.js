// Minimal service worker: offline app shell, network-only API.
// Bump VERSION to force clients onto fresh assets.
const VERSION = "core-v2";
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
  // A share (manifest share_target) carries its content in the query:
  // never cache one, but open the app offline so it can say so and retry.
  if (url.pathname === "/share") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }
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
