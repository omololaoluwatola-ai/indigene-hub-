// INDIGENE service worker
//
// Core app files (home page, auth.js, history.js, manifest, icons)
//   -> open instantly from the saved copy. In the background the new copy is fetched.
//   -> if it is different from the saved one, the saved copy is replaced and the open home page is told,
//      so it refreshes itself (or shows an "Update ready" bar). No cache clearing, ever.
// PDFs                    -> saved copy first, refreshed in the background.
// Admin, mock, CBTs, etc. -> network first (you always see your newest upload), but after 1.5 seconds
//                            of waiting the saved copy is used, so a slow connection never hangs the page.
// Other websites (Firebase, fonts, analytics) are not touched.
const CACHE = "indigene-v5";
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./auth.js", "./history.js", "./install.js",
  "./fonts/bigshoulders-700.woff2", "./fonts/bigshoulders-900.woff2", "./fonts/schibsted-400.woff2", "./fonts/schibsted-500.woff2", "./fonts/schibsted-600.woff2"];
const FAST = new Set(["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/auth.js", "/history.js", "/install.js"]);
const WAIT_MS = 1500;

self.addEventListener("install", (e) => {
  // One missing file must not stop the whole install
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: "reload" }))))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const good = (res) => res && res.ok && res.status === 200 && res.type === "basic";

function save(req, res) {
  if (good(res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
  return res;
}

// Fetch the newest core file. If it differs from the saved one, replace it and tell the open pages.
async function refreshCore(req, cached) {
  const res = await fetch(req, { cache: "no-cache" });
  if (!good(res)) return cached || res;
  let changed = false;
  if (cached) {
    try { changed = (await cached.clone().text()) !== (await res.clone().text()); } catch (e) { changed = false; }
  }
  const c = await caches.open(CACHE);
  const path = new URL(req.url).pathname;
  await c.put(req, res.clone());
  // "/" and "/index.html" are the same page: keep both saved copies in step
  if (path === "/" || path === "/index.html") {
    await c.put(new Request(new URL(path === "/" ? "/index.html" : "/", req.url)), res.clone());
  }
  if (changed) {
    // keep a note too: the page may not be ready to hear the message yet, so it can ask for it once it has loaded
    await c.put(new Request(new URL("/__indigene-pending", req.url)), new Response("1"));
    const list = await self.clients.matchAll({ type: "window" });
    list.forEach((cl) => cl.postMessage({ type: "indigene-updated", path }));
  }
  return res;
}

self.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "hello") return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const key = new Request(new URL("/__indigene-pending", self.location.origin));
    if (await c.match(key)) { await c.delete(key); if (e.source) e.source.postMessage({ type: "indigene-updated" }); }
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // leave other websites alone
  if (req.headers.has("range")) return;                 // partial PDF requests go straight to the network

  if (/\/pdfs\/.+\.pdf$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req).then((res) => save(req, res)).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // Fonts never change: saved copy first, no waiting
  if (url.pathname.indexOf("/fonts/") === 0) {
    e.respondWith(caches.match(req).then((cached) => cached || fetch(req).then((res) => save(req, res))));
    return;
  }

  if (FAST.has(url.pathname)) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const net = refreshCore(req, cached).catch(() => cached);
        if (cached) { e.waitUntil(net.catch(() => {})); return cached.clone(); }   // clone: the original is kept for comparing
        return net.then((r) => r || Response.error());
      })
    );
    return;
  }

  // Everything else: network first, saved copy if the network is slow or gone
  e.respondWith(
    new Promise((resolve) => {
      let settled = false;
      const fallback = () => caches.match(req).then((c) => c || caches.match(req, { ignoreSearch: true }));
      const timer = setTimeout(() => { fallback().then((c) => { if (c && !settled) { settled = true; resolve(c); } }); }, WAIT_MS);
      fetch(req, { cache: "no-cache" })
        .then((res) => { clearTimeout(timer); if (!settled) { settled = true; resolve(save(req, res)); } else save(req, res); })
        .catch(() => { clearTimeout(timer); if (!settled) { settled = true; fallback().then((c) => resolve(c || Response.error())); } });
    })
  );
});
