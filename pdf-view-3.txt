// INDIGENE PDF Viewer (view-only, no download)
// - Renders every page of the PDF onto <canvas> elements using PDF.js.
// - Nothing is ever written to the device's Downloads/Files app: the
//   file is fetched into memory and drawn as pixels, same as any image
//   on a webpage. The browser's normal HTTP cache may keep the raw
//   bytes briefly (same as any site asset) but that is not a saved,
//   reopenable file the person can find or share afterward.
// - Shows a "Loading PDF..." message immediately so large files don't
//   look crashed while they load, and updates with page-load progress.
// - Blocks the easy long-press / right-click "save image" path on the
//   canvas. This does not make the file un-downloadable at the network
//   level (a determined person could still find the raw PDF URL via
//   devtools) -- it removes the casual one-tap download flow.
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

  // Render page 1 into an off-screen canvas FIRST, before touching the
  // visible DOM. This way "100% downloaded" and "PDF actually appears"
  // happen in the same instant instead of leaving a blank gap while
  // page 1 renders after the loading screen has already disappeared.
  const numPages = pdf.numPages;
  if (numPages === 0) {
    renderError();
    return;
  }

  const firstPage = await pdf.getPage(1);
  const containerWidth = container.clientWidth || 900;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped at 2x to avoid huge canvases crashing budget phones on multi-page PDFs
  const firstUnscaled = firstPage.getViewport({ scale: 1 });
  const firstScale = (containerWidth * dpr) / firstUnscaled.width;
  const firstViewport = firstPage.getViewport({ scale: firstScale });

  const firstCanvas = document.createElement("canvas");
  firstCanvas.width = firstViewport.width;
  firstCanvas.height = firstViewport.height;
  firstCanvas.style.display = "block";
  firstCanvas.style.width = containerWidth + "px";
  firstCanvas.style.height = (firstViewport.height / dpr) + "px";
  firstCanvas.style.marginBottom = "8px";
  firstCanvas.style.borderRadius = "8px";
  firstCanvas.oncontextmenu = () => false;
  await firstPage.render({
    canvasContext: firstCanvas.getContext("2d"),
    viewport: firstViewport,
  }).promise;

  // Now swap: clear loading screen and mount page 1 in one shot.
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.id = "pdf-pages";
  wrapper.style.userSelect = "none";
  wrapper.oncontextmenu = () => false; // block long-press / right-click save
  wrapper.appendChild(firstCanvas);
  container.appendChild(wrapper);

  // Render remaining pages in the background after page 1 is already visible.
  for (let pageNum = 2; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const containerWidth = container.clientWidth || 900;
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped at 2x to avoid huge canvases crashing budget phones on multi-page PDFs
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth * dpr) / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = "block";
      canvas.style.width = containerWidth + "px";
      canvas.style.height = (viewport.height / dpr) + "px";
      canvas.style.marginBottom = "8px";
      canvas.style.borderRadius = "8px";
      canvas.oncontextmenu = () => false;
      wrapper.appendChild(canvas);

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      // If a single page fails to render, skip it rather than breaking
      // the whole document.
      continue;
    }
  }

}

renderPdf();
