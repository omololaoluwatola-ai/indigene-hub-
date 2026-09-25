const CACHE = "indigene-v2"; // bumped so any stale cached files from before this fix get cleared
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for PDFs (pdfs/*.pdf): instant load if already seen, and
// works fully offline without waiting on a slow/failed network attempt
// first. Refreshes the cached copy in the background when online so it
// stays up to date without blocking the current view.
// Cache-first for core files, network-first (with cache fallback) for everything else (like cbts/*.html)
//
// Both network fetches below use {cache:"no-store"} to skip the browser's
// own HTTP cache entirely — without that, an updated file (like
// pdf-viewer.js after a fix) can keep silently serving the old version
// from HTTP cache even though this "network-first" logic thinks it's
// getting something fresh.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const isPdf = /\/pdfs\/.+\.pdf$/.test(new URL(e.request.url).pathname);
  if (isPdf) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const networkFetch = fetch(e.request, { cache: "no-store" })
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          })
          .catch(() => cached); // offline and not cached: nothing we can do
        return cached || networkFetch;
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
