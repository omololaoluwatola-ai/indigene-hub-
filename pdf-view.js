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
// - No custom zoom/rotate UI: the page scrolls normally and pinch-zoom
//   is handled natively by the browser (no re-render, no crash risk).
// - Remembers scroll position per PDF (window-level, since the page
//   itself scrolls -- there is no inner scroll box) and restores it
//   on next visit.
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

const DPR = Math.min(window.devicePixelRatio || 1, 2); // capped at 2x: sharp without crashing budget phones on big PDFs

let currentPdf = null;

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
  try {
    localStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
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

async function renderSinglePage(pageNum) {
  const page = await currentPdf.getPage(pageNum);
  const containerWidth = container.clientWidth || 900;
  const unscaledViewport = page.getViewport({ scale: 1 });
  const fitScale = (containerWidth * DPR) / unscaledViewport.width;
  const viewport = page.getViewport({ scale: fitScale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.display = "block";
  canvas.style.width = containerWidth + "px";
  canvas.style.height = (viewport.height / DPR) + "px";
  canvas.style.marginBottom = "8px";
  canvas.style.marginLeft = "auto";
  canvas.style.marginRight = "auto";
  canvas.style.borderRadius = "8px";
  canvas.oncontextmenu = () => false;

  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

async function renderAllPages(wrapper, numPages) {
  wrapper.innerHTML = "";
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const canvas = await renderSinglePage(pageNum);
      wrapper.appendChild(canvas);
    } catch (e) {
      continue;
    }
  }
}

function attachRotationHandler(wrapper) {
  let lastWidth = container.clientWidth;
  const handleResize = debounce(async () => {
    const newWidth = container.clientWidth;
    // Only re-render on an actual width change (real rotation/resize),
    // not on every tiny scroll-triggered layout event.
    if (Math.abs(newWidth - lastWidth) < 20) return;

    // Preserve reading position proportionally: same fraction down the
    // document, not the same pixel offset (which would be wrong once
    // page sizes change).
    const scrollFraction =
      document.documentElement.scrollHeight > window.innerHeight
        ? window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)
        : 0;

    lastWidth = newWidth;
    await renderAllPages(wrapper, currentPdf.numPages);

    window.scrollTo(
      0,
      scrollFraction * (document.documentElement.scrollHeight - window.innerHeight)
    );
  }, 300);

  window.addEventListener("resize", handleResize);
  window.addEventListener("orientationchange", handleResize);
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
  const wrapper = document.createElement("div");
  wrapper.id = "pdf-pages";
  wrapper.style.userSelect = "none";
  wrapper.oncontextmenu = () => false; // block long-press / right-click save
  wrapper.appendChild(firstCanvas);
  container.appendChild(wrapper);

  window.addEventListener("scroll", debouncedSaveScroll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveScrollPosition();
  });
  window.addEventListener("pagehide", saveScrollPosition);
  attachRotationHandler(wrapper);

  // Render remaining pages in the background after page 1 is already visible.
  for (let pageNum = 2; pageNum <= numPages; pageNum++) {
    try {
      const canvas = await renderSinglePage(pageNum);
      wrapper.appendChild(canvas);
    } catch (e) {
      continue;
    }
  }

  // Resume where the reader left off, now that the full document has
  // rendered and page.scrollHeight reflects the real page count.
  try {
    const saved = localStorage.getItem(SCROLL_STORAGE_KEY);
    if (saved) window.scrollTo(0, parseFloat(saved));
  } catch (e) {
    // localStorage may be unavailable — just start at the top.
  }
}

renderPdf();
