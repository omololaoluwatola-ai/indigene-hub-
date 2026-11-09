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
const CACHE = "indigene-v8";
const CORE = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./auth.js", "./history.js", "./install.js",
  "./bigshoulders-700.woff2", "./bigshoulders-900.woff2", "./schibsted-400.woff2", "./schibsted-500.woff2", "./schibsted-600.woff2"];
const FAST = new Set(["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png", "/auth.js", "/history.js", "/install.js"]);
const WAIT_MS = 1500;
// PDF reader pages and the viewer script live in their own saved box that is never wiped when CACHE is renamed,
// so a student who opened a PDF once does not have to open it again with data after a site update.
const KEEP = "indigene-pdfshell";
// Firebase scripts and Google Fonts live on other websites. They are saved here (never wiped on an update)
// so the app can start and look right with data off.
const EXT_BOX = "indigene-ext-v1";
const FB_ROOTS = ["app", "auth", "firestore"].map((n) => "https://www.gstatic.com/firebasejs/10.13.0/firebase-" + n + ".js");
// Pages and scripts every student should have on the phone for offline use. CBT, mock and PDF-reader pages
// are found automatically from the links on the home page, so a new CBT never needs this list edited.
const PAGES = ["/", "/login.html", "/register.html", "/complete-profile.html", "/premium.html", "/mock/mock.html",
  "/auth.js", "/history.js", "/install.js", "/cbt-lock.js", "/protect.js", "/pdf-viewer.js", "/manifest.json"];
const SYNC_EVERY = 45 * 1000;
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
// true only when the two PDFs are byte-for-byte the same
async function sameBytes(cachedRes, blob) {
  try {
    const a = await cachedRes.clone().blob();
    if (a.size !== blob.size) return false;
    const x = new Uint8Array(await a.arrayBuffer()), y = new Uint8Array(await blob.arrayBuffer());
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  } catch (e) { return false; }
}
async function refreshPdfs(force) {
  if (pdfRunning || (!force && Date.now() - pdfLast < 300000)) return;
  if (self.navigator && self.navigator.onLine === false) return;
  pdfRunning = true; pdfLast = Date.now();
  try {
    const box = await caches.open(PDF_BOX);
    const keys = (await box.keys()).filter((r) => /\/pdfs\/.+\.pdf$/.test(new URL(r.url).pathname));
    const changedPdfs = [];
    for (const req of keys) {
      let head;
      try { head = await fetch(req.url, { method: "HEAD", cache: "no-store" }); } catch (e) { pdfLast = 0; break; }   // no internet: try again later
      if (!head.ok) continue;
      const cached = await box.match(req);
      if (!cached) continue;
      const now = sigOf(head.headers), saved = cached.headers.get("x-indigene-sig") || sigOf(cached.headers);
      if (!now || now === saved) continue;                                   // same PDF, or nothing to compare: leave it
      if (self.navigator && self.navigator.connection && self.navigator.connection.saveData) continue;   // phone is in data saver
      let res;
      try { res = await fetch(req.url, { cache: "no-store" }); } catch (e) { pdfLast = 0; break; }
      const type = (res.headers.get("content-type") || "").toLowerCase();
      if (!res.ok || res.status !== 200 || type.indexOf("html") !== -1) continue;   // never save an error page
      const blob = await res.blob();                                         // whole file first, so a dropped connection never leaves half a PDF
      const len = parseInt(res.headers.get("content-length") || "0", 10);
      if (!blob.size || (len && !res.headers.get("content-encoding") && blob.size !== len)) continue;
      const same = await sameBytes(cached, blob);
      const hdrs = new Headers(res.headers); hdrs.set("x-indigene-sig", now);   // remember the server's own fingerprint so this PDF is never swapped twice
      await box.put(req, new Response(blob, { status: 200, headers: hdrs }));
      if (!same) changedPdfs.push(new URL(req.url).pathname);
    }
    if (changedPdfs.length) {
      const wins = await self.clients.matchAll({ type: "window" });
      wins.forEach((cl) => cl.postMessage({ type: "indigene-updated", path: changedPdfs[0], needsReload: false, soft: true }));
    }
  } catch (e) { /* ignore: the saved copies keep working */ }
  finally { pdfRunning = false; }
}

self.addEventListener("install", (e) => {
  // One missing file must not stop the whole install
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => Promise.allSettled([warmExternal(), syncShell(true)]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== KEEP && k !== PDF_BOX && k !== EXT_BOX).map((k) => caches.delete(k))))
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


// ---------- Offline copies of other websites' files (Firebase, fonts) ----------
const isExt = (u) => (u.hostname === "www.gstatic.com" && u.pathname.indexOf("/firebasejs/") === 0) ||
  u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
const offline = () => !!(self.navigator && self.navigator.onLine === false);
let warmDone = false;
// Save the Firebase scripts and every file they import. Only needs to happen once while data is on.
async function warmExternal() {
  if (warmDone || offline()) return;
  const box = await caches.open(EXT_BOX);
  const seen = new Set(), queue = FB_ROOTS.slice();
  let ok = true;
  while (queue.length && seen.size < 40) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    let res = await box.match(u, { ignoreVary: true });
    if (!res) {
      try { res = await fetch(u, { mode: "cors", credentials: "omit" }); } catch (e) { ok = false; continue; }
      if (!res.ok) { ok = false; continue; }
      await box.put(u, res.clone());
    }
    let text = "";
    try { text = await res.clone().text(); } catch (e) { continue; }
    for (const m of text.matchAll(/(?:from|import)\s*["']([^"']+\.js)["']/g)) {
      try { const next = new URL(m[1], u).href; if (next.indexOf("https://www.gstatic.com/firebasejs/") === 0 && !seen.has(next)) queue.push(next); } catch (e) {}
    }
  }
  if (ok) warmDone = true;
}

// ---------- Keep every page saved and up to date ----------
// Looks at the home page links to find all CBT, mock and PDF-reader pages, saves the ones the phone does not have yet,
// and re-downloads the ones that changed on the website (a tiny HEAD check first, so almost no data is used).
// Returns the list of saved files that changed.
let syncing = false, syncLast = 0, lightLast = 0;
async function syncOne(path) {
  const origin = self.location.origin;
  const short = path === "/" ? "/" : path.replace(/\.html$/, "");
  const key = new Request(origin + short);
  const box = await caches.open(isShell(path) ? KEEP : CACHE);
  const saved = await box.match(key);
  if (saved) {
    let head;
    try { head = await fetch(key, { method: "HEAD", cache: "no-store" }); } catch (e) { return false; }
    if (!head.ok) return false;
    const a = sigOf(head.headers), b = sigOf(saved.headers);
    if (a && b && a === b) return false;
  }
  let res;
  try { res = await fetch(key, { cache: "no-cache" }); } catch (e) { return false; }
  if ((!good(res) || res.redirected) && /\.html$/.test(path)) {
    try { res = await fetch(origin + path, { cache: "no-cache" }); } catch (e) { return false; }
  }
  if (!good(res) || res.redirected) return false;
  let changed = false;
  if (saved) { try { changed = (await saved.clone().text()) !== (await res.clone().text()); } catch (e) { changed = false; } }
  await box.put(key, res.clone());
  if (path === "/") await box.put(new Request(origin + "/index.html"), res.clone());   // "/" and "/index.html" stay in step
  return changed;
}
// light = only the few files the home page itself runs on (5 tiny checks), used while the app stays open
async function syncShell(force, light) {
  if (syncing || offline()) return;
  const now = Date.now();
  if (!force && now - (light ? lightLast : syncLast) < (light ? 30000 : SYNC_EVERY)) return;
  syncing = true; lightLast = now; if (!light) syncLast = now;
  const changedPaths = [];
  try {
    const paths = new Set(light ? ["/", "/auth.js", "/history.js", "/install.js", "/protect.js"] : PAGES);
    const cache = await caches.open(CACHE);
    const home = light ? null : await cache.match(new Request(self.location.origin + "/"));
    if (home) {
      let html = "";
      try { html = await home.clone().text(); } catch (e) {}
      for (const m of html.matchAll(/href="((?:cbts|mock|pdfview)\/[A-Za-z0-9_.\/-]+\.html)/g)) paths.add("/" + m[1]);
    }
    const list = Array.from(paths);
    const saveData = !!(self.navigator && self.navigator.connection && self.navigator.connection.saveData);
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const p = list[i++];
        // Data saver on: only look after pages the phone already has
        if (saveData && !(await (await caches.open(isShell(p) ? KEEP : CACHE)).match(new Request(self.location.origin + (p === "/" ? "/" : p.replace(/\.html$/, "")))))) continue;
        try { if (await syncOne(p)) changedPaths.push(p); } catch (e) {}
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally { syncing = false; }
  if (changedPaths.length) {
    const needsReload = changedPaths.some((p) => FAST.has(p) || p === "/protect.js");
    const c = await caches.open(CACHE);
    if (needsReload) await c.put(new Request(new URL("/__indigene-pending", self.location.origin)), new Response("1"));
    const list = await self.clients.matchAll({ type: "window" });
    list.forEach((cl) => cl.postMessage({ type: "indigene-updated", path: changedPaths[0], needsReload, soft: !needsReload }));
  }
}

self.addEventListener("message", (e) => {
  if (!e.data || (e.data.type !== "hello" && e.data.type !== "check" && e.data.type !== "light")) return;
  if (e.data.type === "light") { e.waitUntil(syncShell(false, true)); return; }
  e.waitUntil(refreshPdfs(e.data.type === "check"));
  e.waitUntil(syncShell(e.data.type === "check"));
  e.waitUntil(warmExternal());
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
  // Firebase scripts and Google Fonts: saved copy first, so the app starts with data off
  if (isExt(url)) {
    e.respondWith(caches.open(EXT_BOX).then(async (box) => {
      const hit = await box.match(req.url, { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
        if (res && res.ok) box.put(req.url, res.clone()).catch(() => {});
        return res;
      } catch (err) { return fetch(req); }
    }));
    return;
  }
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
