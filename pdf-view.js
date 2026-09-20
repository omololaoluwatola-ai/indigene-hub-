// INDIGENE PDF Viewer (view-only, no download)
// - Renders every page of the PDF onto <canvas> elements using PDF.js.
// - Nothing is ever written to the device's Downloads/Files app: the
//   file is fetched into memory and drawn as pixels, same as any image
//   on a webpage. The browser's normal HTTP cache may keep the raw
//   bytes briefly (same as any site asset) but that is not a saved,
//   reopenable file the person can find or share afterward.
// - Shows a "Loading PDF..." message with an accurate byte-download
//   percentage (streaming disabled so it's a true progress, not an
//   estimate), and renders page 1 in the background before swapping
//   away the loading screen so 100% and "PDF appears" land together.
// - Renders at 2x device pixel density (capped) so text is sharp on
//   phone screens instead of blurry/stretched.
// - Blocks the easy long-press / right-click "save image" path on the
//   canvas. This does not make the file un-downloadable at the network
//   level (a determined person could still find the raw PDF URL via
//   devtools) -- it removes the casual one-tap download flow.
// - Zoom (toolbar +/- buttons AND two-finger pinch) and rotate
//   (toolbar button, 90-degree steps). Zoom re-renders each page at
//   the new resolution for crisp text rather than CSS-stretching.
//
// Usage (unchanged from pdf-lock.js's markup contract):
//   <div id="pdf-container"></div>
//   <script type="module" src="../pdf-view.js" data-pdf="pdfs/ana203.pdf" data-id="ana203"></script>

import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

const thisScript =
  document.currentScript ||
  document.querySelector('script[src$="pdf-view.js"]');

const rawPdfPath = thisScript.getAttribute("data-pdf");
const pdfId = thisScript.getAttribute("data-id") || "document";
const container = document.getElementById("pdf-container");

// Resolve the PDF path relative to this script's own location (repo root)
// rather than the current page's location (pdfview/), so pages living in
// subfolders still find pdfs/{file}.pdf correctly.
const pdfUrl = new URL(rawPdfPath, thisScript.src).href;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const DPR = Math.min(window.devicePixelRatio || 1, 2); // capped at 2x: sharp without crashing budget phones on big PDFs

let currentPdf = null;
let zoomLevel = 1;
let rotation = 0; // degrees: 0, 90, 180, 270
let pagesWrapper = null;
let scrollArea = null;
let toolbarZoomLabel = null;

const SCROLL_STORAGE_KEY = `indigene_pdf_scroll_${pdfId}`;
const RECENT_STORAGE_KEY = "indigene_recent_pdfs";
const RECENT_MAX = 5;

function recordRecentlyOpened() {
  try {
    const h1 = document.querySelector("h1");
    const title = (h1 && h1.textContent.trim()) || document.title || pdfId;
    const href = `pdfview/${pdfId}.html`; // relative to index.html at repo root

    let recents = [];
    try {
      recents = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]");
    } catch (e) {
      recents = [];
    }

    recents = recents.filter((r) => r.id !== pdfId);
    recents.unshift({ id: pdfId, title, href, ts: Date.now() });
    recents = recents.slice(0, RECENT_MAX);

    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recents));
  } catch (e) {
    // localStorage may be unavailable — the resume row just won't show this visit.
  }
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function saveScrollPosition() {
  if (!scrollArea) return;
  try {
    localStorage.setItem(SCROLL_STORAGE_KEY, String(scrollArea.scrollTop));
  } catch (e) {
    // localStorage may be unavailable (private mode, storage full) — fail silently.
  }
}

const debouncedSaveScroll = debounce(saveScrollPosition, 400);

function renderLoading(percent) {
  const pct = percent != null ? ` (${percent}%)` : "";
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:40px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:36px; margin-bottom:12px;">📄</div>
      <h3 style="color:#ffb703; margin:0 0 8px 0;">Loading PDF${pct}</h3>
      <p style="color:#aaa; margin:0;">Large files can take a moment — this hasn't crashed.</p>
    </div>
  `;
}

function renderError() {
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:40px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:36px; margin-bottom:12px;">⚠️</div>
      <h3 style="color:#ffb703; margin:0 0 8px 0;">Couldn't load this PDF</h3>
      <p style="color:#aaa; margin:0;">Check your connection and reload the page.</p>
    </div>
  `;
}

function buildToolbar() {
  const bar = document.createElement("div");
  bar.style.cssText = `
    position: sticky; top: 8px; z-index: 10;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    background: #161616; border: 1px solid #2a2a2a; border-radius: 999px;
    padding: 8px 10px; margin: 0 auto 12px auto; width: fit-content;
    font-family: -apple-system, sans-serif;
  `;

  function makeBtn(label, title) {
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.style.cssText = `
      background: #232323; color: #ffb703; border: none; border-radius: 999px;
      width: 40px; height: 40px; font-size: 18px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
    `;
    return b;
  }

  const zoomOutBtn = makeBtn("−", "Zoom out");
  const zoomInBtn = makeBtn("+", "Zoom in");
  const rotateBtn = makeBtn("⟳", "Rotate 90°");
  const resetBtn = makeBtn("⟲", "Reset view");

  toolbarZoomLabel = document.createElement("span");
  toolbarZoomLabel.style.cssText = "color:#aaa; font-size:13px; min-width:44px; text-align:center;";
  toolbarZoomLabel.textContent = "100%";

  zoomOutBtn.onclick = () => setZoom(zoomLevel - ZOOM_STEP);
  zoomInBtn.onclick = () => setZoom(zoomLevel + ZOOM_STEP);
  rotateBtn.onclick = () => { rotation = (rotation + 90) % 360; rerenderAllPages(); };
  resetBtn.onclick = () => { zoomLevel = 1; rotation = 0; rerenderAllPages(); };

  bar.appendChild(zoomOutBtn);
  bar.appendChild(toolbarZoomLabel);
  bar.appendChild(zoomInBtn);
  bar.appendChild(rotateBtn);
  bar.appendChild(resetBtn);
  return bar;
}

function setZoom(newZoom) {
  zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  rerenderAllPages();
}

async function renderSinglePage(pageNum) {
  const page = await currentPdf.getPage(pageNum);
  const containerWidth = container.clientWidth || 900;
  const unscaledViewport = page.getViewport({ scale: 1, rotation });
  const fitScale = containerWidth / unscaledViewport.width;
  const finalScale = fitScale * zoomLevel * DPR;
  const viewport = page.getViewport({ scale: finalScale, rotation });

  const canvas = document.createElement("canvas");
  canvas.dataset.page = String(pageNum);
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.display = "block";
  canvas.style.width = (viewport.width / DPR) + "px";
  canvas.style.height = (viewport.height / DPR) + "px";
  canvas.style.marginBottom = "8px";
  canvas.style.marginLeft = "auto";
  canvas.style.marginRight = "auto";
  canvas.style.borderRadius = "8px";
  canvas.oncontextmenu = () => false;

  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

async function rerenderAllPages() {
  if (!currentPdf || !pagesWrapper) return;
  if (toolbarZoomLabel) toolbarZoomLabel.textContent = Math.round(zoomLevel * 100) + "%";

  const numPages = currentPdf.numPages;
  // Render all pages fresh at the new zoom/rotation, then swap in one go
  // so the view doesn't flicker page-by-page while re-rendering.
  const newCanvases = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      newCanvases.push(await renderSinglePage(pageNum));
    } catch (e) {
      continue;
    }
  }
  pagesWrapper.innerHTML = "";
  newCanvases.forEach((c) => pagesWrapper.appendChild(c));
}

function attachPinchZoom(scrollArea) {
  let pinching = false;
  let startDist = 0;
  let startZoom = 1;

  function dist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  scrollArea.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinching = true;
      startDist = dist(e.touches);
      startZoom = zoomLevel;
    }
  }, { passive: true });

  scrollArea.addEventListener("touchmove", (e) => {
    if (pinching && e.touches.length === 2) {
      e.preventDefault();
      const newDist = dist(e.touches);
      const factor = newDist / startDist;
      // Live CSS preview during the gesture (cheap, may look slightly soft
      // mid-pinch); a crisp re-render happens once the gesture ends.
      const previewZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, startZoom * factor));
      pagesWrapper.style.transform = `scale(${previewZoom / zoomLevel})`;
      pagesWrapper.dataset.pendingZoom = previewZoom;
    }
  }, { passive: false });

  scrollArea.addEventListener("touchend", (e) => {
    if (pinching && e.touches.length < 2) {
      pinching = false;
      pagesWrapper.style.transform = "";
      const pending = parseFloat(pagesWrapper.dataset.pendingZoom);
      if (!isNaN(pending)) {
        delete pagesWrapper.dataset.pendingZoom;
        setZoom(pending);
      }
    }
  });

  // Allow native single-finger vertical scrolling; only intercept 2-finger pinch.
  scrollArea.style.touchAction = "pan-y";
}

async function renderPdf() {
  renderLoading(0);

  let pdf;
  try {
    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      disableStream: true,      // force full download instead of range-request streaming,
      disableAutoFetch: true,   // so onProgress reflects true bytes downloaded, not an estimate
    });
    loadingTask.onProgress = (progress) => {
      if (progress.total) {
        const pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
        renderLoading(pct);
      }
    };
    pdf = await loadingTask.promise;
  } catch (e) {
    renderError();
    return;
  }

  currentPdf = pdf;
  const numPages = pdf.numPages;
  if (numPages === 0) {
    renderError();
    return;
  }

  recordRecentlyOpened();

  // Render page 1 first, off-screen, before touching the visible DOM —
  // so "100% downloaded" and "PDF actually appears" land in the same
  // instant instead of a blank gap while page 1 renders.
  const firstCanvas = await renderSinglePage(1);

  container.innerHTML = "";
  const toolbar = buildToolbar();
  container.appendChild(toolbar);

  const scrollAreaEl = document.createElement("div");
  scrollAreaEl.id = "pdf-scroll-area";
  scrollAreaEl.style.cssText = "overflow: auto; -webkit-overflow-scrolling: touch;";
  scrollArea = scrollAreaEl;

  pagesWrapper = document.createElement("div");
  pagesWrapper.id = "pdf-pages";
  pagesWrapper.style.userSelect = "none";
  pagesWrapper.style.transformOrigin = "top center";
  pagesWrapper.oncontextmenu = () => false; // block long-press / right-click save
  pagesWrapper.appendChild(firstCanvas);

  scrollAreaEl.appendChild(pagesWrapper);
  container.appendChild(scrollAreaEl);
  attachPinchZoom(scrollAreaEl);

  scrollAreaEl.addEventListener("scroll", debouncedSaveScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScrollPosition();
  });
  window.addEventListener("pagehide", saveScrollPosition);

  // Render remaining pages in the background after page 1 is already visible.
  for (let pageNum = 2; pageNum <= numPages; pageNum++) {
    try {
      const canvas = await renderSinglePage(pageNum);
      pagesWrapper.appendChild(canvas);
    } catch (e) {
      continue;
    }
  }

  // Resume where the reader left off, now that the full document has
  // rendered and scrollHeight reflects the real page count.
  try {
    const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
    if (saved) scrollAreaEl.scrollTop = parseFloat(saved);
  } catch (e) {
    // localStorage may be unavailable — just start at the top.
  }
}

renderPdf();
