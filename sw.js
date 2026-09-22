const CACHE = "indigene-v1";
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

// Cache-first for PDFs (pdfs/*.pdf) AND the PDF.js viewer's own static
// assets (pdfjs-viewer/*): instant load if already seen, and works fully
// offline without waiting on a slow/failed network attempt first.
// Refreshes the cached copy in the background when online so it stays
// up to date without blocking the current view.
// Network-first (with cache fallback) for everything else (like cbts/*.html)
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);
  const isCacheFirst =
    /\/pdfs\/.+\.pdf$/.test(url.pathname) ||
    /\/pdfjs-viewer\//.test(url.pathname);

  if (isCacheFirst) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const networkFetch = fetch(e.request)
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
