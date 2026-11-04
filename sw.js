// INDIGENE service worker
//
// Core app files (home page, auth.js, history.js, manifest, icons)
//   -> open instantly from the saved copy. In the background the new copy is fetched.
//   -> if it is different from the saved one, the saved copy is replaced and the open home page is told,
//      so it refreshes itself (or shows an "Update ready" bar). No cache clearing, ever.
// PDFs                    -> not handled here. The PDF viewer (pdf-viewer.js) saves each PDF on the phone,
//                            opens it with no data, and replaces it when you upload a new one.
// Admin, mock, CBTs, etc. -> network first (you always see your newest upload), but after 1.5 seconds
//                            of waiting the saved copy is used, so a slow connection never hangs the page.
// Other websites (Firebase, fonts, analytics) are not touched.
const CACHE = "indigene-v7";
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./auth.js", "./history.js", "./install.js",
  "./bigshoulders-700.woff2", "./bigshoulders-900.woff2", "./schibsted-400.woff2", "./schibsted-500.woff2", "./schibsted-600.woff2"];
const FAST = new Set(["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/auth.js", "/history.js", "/install.js"]);
const WAIT_MS = 1500;
// PDF reader pages and the viewer script live in their own saved box that is never wiped when CACHE is renamed,
// so a student who opened a PDF once does not have to open it again with data after a site update.
const KEEP = "indigene-pdfshell";
// The PDF viewer keeps the saved PDFs (and the PDF.js library) in this box. It must NEVER be wiped on an update.
const PDF_BOX = "pdfv-assets-v1";
const isShell = (p) => p.indexOf("/pdfview/") === 0 || p === "/pdf-viewer.js";

// Quiet PDF refresh. Whenever the phone gets any internet (the app or any page makes a request that can go out),
// check every PDF the student has saved. Only a tiny HEAD request per PDF. If you replaced a PDF on the site,
// the new one is downloaded fully, then swapped in. Nothing to clear. At most once every 5 minutes.
let pdfRunning = false, pdfLast = 0;
const sigOf = (h) => {
  const t = (h.get("etag") || "").replace(/^W\//, "").replace(/"/g, "");
  if (t) return "e:" + t;
  const m = h.get("last-modified");
  return m ? "m:" + m : "";
};
async function refreshPdfs() {
  if (pdfRunning || Date.now() - pdfLast < 300000) return;
  if (self.navigator && self.navigator.onLine === false) return;
  pdfRunning = true; pdfLast = Date.now();
  try {
    const box = await caches.open(PDF_BOX);
    const keys = (await box.keys()).filter((r) => /\/pdfs\/.+\.pdf$/.test(new URL(r.url).pathname));
    for (const req of keys) {
      let head;
      try { head = await fetch(req.url, { method: "HEAD", cache: "no-store" }); } catch (e) { pdfLast = 0; return; }   // no internet: try again later
      if (!head.ok) continue;
      const cached = await box.match(req);
      if (!cached) continue;
      const now = sigOf(head.headers), saved = sigOf(cached.headers);
      if (!now || now === saved) continue;                                   // same PDF, or nothing to compare: leave it
      if (self.navigator && self.navigator.connection && self.navigator.connection.saveData) continue;   // phone is in data saver
      let res;
      try { res = await fetch(req.url, { cache: "no-store" }); } catch (e) { pdfLast = 0; return; }
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok || res.status !== 200 || type.indexOf("html") !== -1) continue;   // never save an error page
      const blob = await res.blob();                                         // whole file first, so a dropped connection never leaves half a PDF
      const len = parseInt(res.headers.get("content-length") || "0", 10);
      if (!blob.size || (len && !res.headers.get("content-encoding") && blob.size !== len)) continue;
      await box.put(req, new Response(blob, { status: 200, headers: res.headers }));
    }
  } catch (e) { /* ignore: the saved copies keep working */ }
  finally { pdfRunning = false; }
}

self.addEventListener("install", (e) => {
  // One missing file must not stop the whole install
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: "reload" }))))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== KEEP && k !== PDF_BOX).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const good = (res) => res && res.ok && res.status === 200 && res.type === "basic";

function save(req, res) {
  if (good(res)) {
    const copy = res.clone();
    const name = isShell(new URL(req.url).pathname) ? KEEP : CACHE;
    caches.open(name).then((c) => c.put(req, copy)).catch(() => {});
  }
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
  e.waitUntil(refreshPdfs());
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

  // PDFs: the PDF viewer saves and updates them itself. Pass straight through so a PDF is never stored twice
  // and the viewer always sees the newest file on the server when it checks for a replacement.
  if (/\/pdfs\/.+\.pdf$/.test(url.pathname)) return;

  // Fonts never change: saved copy first, no waiting
  if (/\.woff2$/.test(url.pathname)) {
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
      // Cloudflare turns /pdfview/x.html into /pdfview/x, so the page is saved under the short address.
      // With data off, a tap on the .html link must find that saved page too.
      const fallback = () => caches.match(req)
        .then((c) => c || caches.match(req, { ignoreSearch: true }))
        .then((c) => c || (/\.html$/.test(url.pathname) ? caches.match(new Request(url.origin + url.pathname.slice(0, -5)), { ignoreSearch: true }) : undefined));
      const timer = setTimeout(() => { fallback().then((c) => { if (c && !settled) { settled = true; resolve(c); } }); }, WAIT_MS);
      fetch(req, { cache: "no-cache" })
        .then((res) => { clearTimeout(timer); if (!settled) { settled = true; resolve(save(req, res)); } else save(req, res); })
        .catch(() => { clearTimeout(timer); if (!settled) { settled = true; fallback().then((c) => resolve(c || Response.error())); } });
    })
  );
});
