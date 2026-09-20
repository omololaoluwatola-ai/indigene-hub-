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

const thisScript = document.currentScript;
const pdfUrl = thisScript.getAttribute("data-pdf");
const pdfId = thisScript.getAttribute("data-id") || "document";
const container = document.getElementById("pdf-container");

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
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
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

  // Clear the loading UI and prepare the canvas wrapper before rendering pages.
  container.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.id = "pdf-pages";
  wrapper.style.userSelect = "none";
  wrapper.oncontextmenu = () => false; // block long-press / right-click save
  container.appendChild(wrapper);

  const numPages = pdf.numPages;
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const containerWidth = container.clientWidth || 900;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / unscaledViewport.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.display = "block";
      canvas.style.width = "100%";
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

  if (numPages === 0) {
    renderError();
  }
}

renderPdf();
