// Service worker: offline app shell, network-only API.
// - Page loads go to the network first, so a deploy shows up on the next
//   open; offline, any route gets the cached shell (the SPA routes itself).
// - /assets/ is content-hashed: cache first, it never changes.
// - Everything else same-origin, and Google Fonts: cached copy at once,
//   refreshed in the background.
// Bump VERSION to drop every cached file (old hashed assets pile up until then).
const VERSION = "core-v4";
const FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];
// Files shared from another app, waiting for the Feed to pick them up.
// Kept apart from VERSION so an update never drops them.
const SHARED = "core-shared-files";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/apple-touch-icon.png",
];

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
        Promise.all(keys.filter((k) => k !== VERSION && k !== SHARED).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// A share from another app (manifest share_target) arrives as a multipart
// POST. Its files wait in the SHARED cache, replacing any an earlier share
// left unposted, and the app opens /share with the text in the query and
// files=<id> marking the waiting files (src/lib/shared-files.ts reads
// them back).
async function takeShare(request) {
  const query = new URLSearchParams();
  let form;
  try {
    form = await request.formData();
  } catch {
    query.set("failed", "unreadable");
    return Response.redirect(`/share?${query}`, 303);
  }
  for (const name of ["title", "text", "url"]) {
    const value = form.get(name);
    if (typeof value === "string" && value.trim()) query.set(name, value);
  }
  // An empty part with no name is a file input left blank; an empty file
  // with a name is kept, so the Feed refuses it as the picker would.
  const files = form.getAll("files").filter((f) => typeof f !== "string" && (f.name || f.size > 0));
  if (files.length > 0) {
    try {
      query.set("files", await keepFiles(files));
    } catch {
      // Too big to keep (storage full): the text still goes through.
      query.set("failed", "files");
    }
  }
  return Response.redirect(`/share?${query}`, 303);
}

// keepFiles stores a share's files and says under which id.
async function keepFiles(files) {
  const id = crypto.randomUUID();
  await caches.delete(SHARED);
  const cache = await caches.open(SHARED);
  await Promise.all(
    files.map((f, i) =>
      cache.put(
        `/shared-files/${id}/${i}`,
        new Response(f, {
          headers: { "Content-Type": f.type || "application/octet-stream", "X-Filename": encodeURIComponent(f.name) },
        }),
      ),
    ),
  );
  return id;
}

function cachePut(request, res) {
  // Opaque (no-cors) font responses report status 0 but are fine to keep.
  if (res.ok || res.type === "opaque") {
    const copy = res.clone();
    caches.open(VERSION).then((c) => c.put(request, copy));
  }
  return res;
}

function networkFirstPage(request) {
  return fetch(request)
    .then((res) => {
      if (res.ok) cachePut("/index.html", res.clone());
      return res;
    })
    .catch(() => caches.match("/index.html").then((hit) => hit || Response.error()));
}

function cacheFirst(request) {
  return caches.match(request).then((hit) => hit || fetch(request).then((res) => cachePut(request, res)));
}

function staleWhileRevalidate(event) {
  const { request } = event;
  return caches.match(request).then((hit) => {
    const net = fetch(request)
      .then((res) => cachePut(request, res))
      .catch(() => hit || Response.error());
    if (hit) {
      event.waitUntil(net.catch(() => {}));
      return hit;
    }
    return net;
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share") {
    event.respondWith(takeShare(request));
    return;
  }
  if (request.method !== "GET") return;
  if (FONT_ORIGINS.includes(url.origin)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return; // auth API: never cache
  // A share (manifest share_target) carries its content in the query:
  // never cache one, but open the app offline so it can say so and retry.
  if (url.pathname === "/share") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event));
});
