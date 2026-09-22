// INDIGENE PDF page helpers — pairs with the self-hosted PDF.js viewer
// (pdfjs-viewer/web/viewer.html) embedded via <iframe>.
//
// Handles three things the stock viewer doesn't do on its own:
// 1. Resume where the reader left off (per PDF, by page number).
// 2. "Continue Reading" tracking for the homepage resume row.
// 3. Keeps the screen from locking/dimming while actively reading
//    (Screen Wake Lock API), released when the tab is hidden/closed.
//
// Also disarms the viewer's download/print keyboard shortcuts
// (Ctrl+S / Ctrl+P) as defense in depth — the buttons themselves are
// already hidden via indigene-overrides.css.
//
// Usage:
//   <iframe id="pdf-frame" src="../pdfjs-viewer/web/viewer.html?file=../pdfs/{id}.pdf"></iframe>
//   <script src="../pdf-page-helpers.js" data-pdf-id="{id}"></script>

(function () {
  const thisScript = document.currentScript;
  const pdfId = thisScript.getAttribute("data-pdf-id");
  const iframe = document.getElementById("pdf-frame");

  const PAGE_STORAGE_KEY = `indigene_pdf_page_${pdfId}`;
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

  function savePage(pageNumber) {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, String(pageNumber));
    } catch (e) {
      // localStorage may be unavailable (private mode, storage full) — fail silently.
    }
  }

  const debouncedSavePage = debounce(savePage, 400);

  // --- Screen Wake Lock: keep the screen on while actively reading ---
  let wakeLock = null;

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (e) {
      // Can be refused (low battery, backgrounded, unsupported) — fail silently.
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  });
  window.addEventListener("pagehide", releaseWakeLock);
  requestWakeLock();

  // --- Hook into the PDF.js viewer app once it finishes initializing ---
  function waitForViewerApp() {
    const win = iframe.contentWindow;
    if (win && win.PDFViewerApplication && win.PDFViewerApplication.initializedPromise) {
      win.PDFViewerApplication.initializedPromise.then(() => {
        const app = win.PDFViewerApplication;

        // Defense in depth: toolbar buttons are already hidden via CSS,
        // but this disarms the Ctrl+S / Ctrl+P keyboard-shortcut paths too.
        app.downloadOrSave = () => {};
        app.triggerPrinting = () => {};

        app.eventBus.on("pagesloaded", () => {
          recordRecentlyOpened();

          // Resume where the reader left off.
          try {
            const saved = localStorage.getItem(PAGE_STORAGE_KEY);
            if (saved) {
              app.page = parseInt(saved, 10);
            }
          } catch (e) {
            // localStorage may be unavailable — just start at page 1.
          }
        });

        app.eventBus.on("pagechanging", (evt) => {
          debouncedSavePage(evt.pageNumber);
        });
      });
    } else {
      // Viewer script inside the iframe hasn't finished initializing yet.
      setTimeout(waitForViewerApp, 150);
    }
  }

  iframe.addEventListener("load", waitForViewerApp);
})();
