/* ============================================================
   INDIGENE PDF VIEWER
   Free, in-page, canvas-only PDF reader. No lock, no download
   path, no native PDF-reader handoff — nothing but this script
   ever points at the raw PDF file.

   Wire it into a pdfview/{id}.html page like this:
     <div id="pdf-container" data-pdf="../pdfs/x.pdf" data-id="x"></div>
     <script src="../pdf-viewer.js"></script>

   Features:
     - Continuous vertical scroll through the whole document
       (native momentum scrolling, not paged/swipe navigation).
     - Always full screen. The viewer covers the whole viewport
       at all times (CSS), and also asks the browser for real
       fullscreen on load, on every tap, and again whenever
       fullscreen gets exited.
     - No zoom, no rotate. Pages always fit the screen width.
     - Resumes exactly where the reader left off (per file, saved
       to localStorage) instead of restarting from page 1.
     - Screen Wake Lock — display stays on while this page is open
       and visible.
     - Defensive: PDF.js loading, the fetch, and every single page's
       render are wrapped independently. One bad page shows a small
       "couldn't render" placeholder instead of breaking the reader,
       and a full load failure shows a retry button instead of a
       blank screen.
   ============================================================ */

(function () {
  'use strict';

  var PDFJS_VERSION = '3.11.174';
  var PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VERSION + '/';
  var MAX_CANVAS_W = 2200; // memory guard on low-end phones

  var container = document.getElementById('pdf-container');
  if (!container) return;

  var pdfUrl = container.dataset.pdf;
  var pdfId = container.dataset.id;
  if (!pdfUrl || !pdfId) {
    showError(container, 'This page is missing its PDF reference.');
    return;
  }

  injectStyles();
  container.classList.add('pdfv-root');

  var scroller = document.createElement('div');
  scroller.className = 'pdfv-scroller';
  var pagesWrap = document.createElement('div');
  pagesWrap.className = 'pdfv-pages';
  scroller.appendChild(pagesWrap);
  container.appendChild(scroller);

  var loadingEl = document.createElement('div');
  loadingEl.className = 'pdfv-loading';
  loadingEl.innerHTML =
    '<div class="pdfv-load-label">LOADING PDF</div>' +
    '<div class="pdfv-load-track"><div class="pdfv-load-fill"></div></div>' +
    '<div class="pdfv-load-pct">0%</div>';
  container.appendChild(loadingEl);
  var loadFill = loadingEl.querySelector('.pdfv-load-fill');
  var loadPct = loadingEl.querySelector('.pdfv-load-pct');

  function setLoadProgress(pct) {
    var clamped = Math.max(0, Math.min(100, Math.round(pct)));
    loadFill.style.width = clamped + '%';
    loadPct.textContent = clamped + '%';
  }
  function setLoadIndeterminate() {
    loadingEl.classList.add('pdfv-load-indeterminate');
    loadPct.textContent = '';
  }

  var hud = document.createElement('div');
  hud.className = 'pdfv-hud';
  container.appendChild(hud);

  // best-effort save/copy deterrents (screenshots & screen recording
  // are OS-level and no webpage can block those)
  scroller.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  scroller.addEventListener('dragstart', function (e) { e.preventDefault(); });
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) e.preventDefault();
  });

  var pdfDoc = null;
  var pageCount = 0;
  var pageDivs = [];
  var pageHeightPx = 0; // uniform page height estimate (assumes consistent page size in the doc)
  var pageGap = 10;
  var baseWidth = 0;
  var fitScale = 1;

  requestWakeLock();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      requestFullscreenSafe();
    } else {
      releaseWakeLock();
    }
  });

  loadScript(PDFJS_BASE + 'pdf.min.js')
    .then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js';
      var loadingTask = window.pdfjsLib.getDocument({
        url: pdfUrl,
        disableRange: true,
        disableStream: true
      });
      var sawRealProgress = false;
      loadingTask.onProgress = function (data) {
        if (data && data.total) {
          sawRealProgress = true;
          setLoadProgress((data.loaded / data.total) * 100);
        } else if (!sawRealProgress) {
          // server didn't send a Content-Length — no real percentage to show,
          // so be honest about it instead of faking a number
          setLoadIndeterminate();
        }
      };
      return loadingTask.promise;
    })
    .then(function (doc) {
      pdfDoc = doc;
      pageCount = doc.numPages;
      setLoadProgress(100);
      return doc.getPage(1);
    })
    .then(function (firstPage) {
      buildPageSlots(firstPage);
      loadingEl.remove();
      attachObserver();
      attachFullscreenLock();
      restoreScrollPosition();
      flashHud('Page ' + currentPage() + ' of ' + pageCount);
    })
    .catch(function () {
      showError(container, 'Could not open this PDF. Check your connection and try again.');
    });

  // ---------- layout ----------
  function buildPageSlots(firstPage) {
    var vp1 = firstPage.getViewport({ scale: 1 });
    baseWidth = Math.max(scroller.clientWidth, 280);
    fitScale = baseWidth / vp1.width;
    pageHeightPx = Math.round(vp1.height * fitScale);

    for (var i = 1; i <= pageCount; i++) {
      var div = document.createElement('div');
      div.className = 'pdfv-page';
      div.dataset.page = String(i);
      div.style.width = baseWidth + 'px';
      div.style.height = pageHeightPx + 'px';
      div.style.marginBottom = pageGap + 'px';
      pagesWrap.appendChild(div);
      pageDivs.push(div);
    }
  }

  // screen size changed (fullscreen kicked in / phone turned / resize):
  // rescale the slots to the new width and keep the reader on the same spot.
  // Canvases are width:100%, so they just scale with their slot.
  function relayout() {
    if (!pageDivs.length) return;
    var newWidth = Math.max(scroller.clientWidth, 280);
    if (!baseWidth || Math.abs(newWidth - baseWidth) < 2) return;
    var ratio = newWidth / baseWidth;
    var newTop = scroller.scrollTop * ratio;
    baseWidth = newWidth;
    fitScale *= ratio;
    pageHeightPx = Math.round(pageHeightPx * ratio);
    pageDivs.forEach(function (div) {
      var h = div.clientHeight || pageHeightPx;
      div.style.width = baseWidth + 'px';
      div.style.height = Math.round(h * ratio) + 'px';
    });
    scroller.scrollTop = newTop;
  }
  window.addEventListener('resize', relayout);

  function renderPage(num) {
    var div = pageDivs[num - 1];
    if (!div || div.dataset.rendered) return;
    div.dataset.rendered = 'pending';

    pdfDoc.getPage(num).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      // render sharp enough for the widest the screen can get (full screen)
      var targetW = Math.max(baseWidth, window.screen ? window.screen.width : 0) * dpr;
      targetW = Math.min(targetW, MAX_CANVAS_W);
      var renderScale = targetW / vp1.width;
      var viewport = page.getViewport({ scale: renderScale });

      var canvas = document.createElement('canvas');
      canvas.className = 'pdfv-canvas';
      canvas.setAttribute('draggable', 'false');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      var ctx = canvas.getContext('2d');
      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        div.innerHTML = '';
        div.appendChild(canvas);
        div.dataset.rendered = 'done';
        // real page height may differ slightly from the placeholder
        // estimate — correct it without disturbing scroll position
        var correctH = Math.round(vp1.height * (baseWidth / vp1.width));
        if (Math.abs(correctH - div.clientHeight) > 2) {
          var delta = correctH - div.clientHeight;
          var beforeScroll = scroller.scrollTop;
          div.style.height = correctH + 'px';
          if (div.offsetTop < beforeScroll) scroller.scrollTop = beforeScroll + delta;
        }
      });
    }).catch(function () {
      div.dataset.rendered = 'failed';
      div.innerHTML = '<div class="pdfv-page-error">Page ' + num + ' couldn\u2019t render</div>';
    });
  }

  function attachObserver() {
    if (!('IntersectionObserver' in window)) {
      // fallback for very old browsers: just render everything
      for (var i = 1; i <= pageCount; i++) renderPage(i);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          renderPage(parseInt(entry.target.dataset.page, 10));
        }
      });
    }, { root: scroller, rootMargin: '1200px 0px', threshold: 0.01 });
    pageDivs.forEach(function (div) { io.observe(div); });
  }

  // ---------- resume position ----------
  var saveTimer = null;
  scroller.addEventListener('scroll', function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScrollPosition, 400);
  });

  function currentPage() {
    var unit = pageHeightPx + pageGap;
    if (!unit) return 1;
    return Math.min(pageCount, Math.max(1, Math.round(scroller.scrollTop / unit) + 1));
  }
  function saveScrollPosition() {
    try {
      var all = JSON.parse(localStorage.getItem('pdfv-progress') || '{}');
      all[pdfId] = scroller.scrollTop;
      localStorage.setItem('pdfv-progress', JSON.stringify(all));
    } catch (e) { /* private mode / storage full — resume just won't work this time */ }
  }
  function restoreScrollPosition() {
    try {
      var all = JSON.parse(localStorage.getItem('pdfv-progress') || '{}');
      var saved = all[pdfId];
      if (typeof saved === 'number' && saved > 0) {
        scroller.scrollTop = saved;
        flashHud('Resumed at page ' + currentPage());
      }
    } catch (e) {}
  }

  // ---------- wake lock ----------
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) { wakeLock = lock; }).catch(function () {});
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
  }

  // ---------- fullscreen (always on) ----------
  // The .pdfv-root CSS already pins the viewer over the whole viewport,
  // so it is "full screen" even on browsers with no Fullscreen API
  // (e.g. iPhone Safari). On top of that we keep asking for real
  // fullscreen: on load, on EVERY tap/touch, and whenever it's exited.
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
  }
  function requestFullscreenSafe() {
    if (isFullscreen()) return;
    var req = container.requestFullscreen || container.webkitRequestFullscreen || container.msRequestFullscreen;
    if (!req) return;
    try {
      var result = req.call(container);
      if (result && result.catch) result.catch(function () { /* blocked without a user gesture — the next tap retries */ });
    } catch (e) { /* ignore — same reason */ }
  }
  function attachFullscreenLock() {
    requestFullscreenSafe();
    ['pointerdown', 'touchend', 'click'].forEach(function (evt) {
      scroller.addEventListener(evt, requestFullscreenSafe, { passive: true });
    });
    ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'].forEach(function (evt) {
      document.addEventListener(evt, function () {
        // layout width changes when fullscreen toggles — fix it up, and
        // if the reader just got kicked out, try to go straight back in
        setTimeout(relayout, 150);
        if (!isFullscreen()) setTimeout(requestFullscreenSafe, 0);
      });
    });
  }

  // ---------- helpers ----------
  var hudTimer = null;
  function flashHud(text) {
    hud.textContent = text;
    hud.classList.add('pdfv-show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { hud.classList.remove('pdfv-show'); }, 1800);
  }

  function showError(el, msg) {
    el.classList.add('pdfv-root');
    el.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'pdfv-error';
    box.innerHTML = '<div class="pdfv-error-msg"></div><button class="pdfv-retry">RETRY</button>';
    box.querySelector('.pdfv-error-msg').textContent = msg;
    box.querySelector('.pdfv-retry').addEventListener('click', function () { window.location.reload(); });
    el.appendChild(box);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function injectStyles() {
    if (document.getElementById('pdfv-styles')) return;
    var style = document.createElement('style');
    style.id = 'pdfv-styles';
    style.textContent =
      // pinned over the whole viewport no matter what the page around it does
      'html,body{margin:0;padding:0;overflow:hidden;}' +
      '.pdfv-root{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;margin:0;padding:0;' +
      'z-index:2147483000;background:#0b0704;overflow:hidden;' +
      '-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}' +
      '.pdfv-root:fullscreen{width:100vw;height:100vh;}' +
      '.pdfv-root:-webkit-full-screen{width:100vw;height:100vh;}' +
      '.pdfv-root:-ms-fullscreen{width:100vw;height:100vh;}' +
      // pan-y only: vertical scroll works, pinch-zoom is blocked
      '.pdfv-scroller{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;' +
      '-webkit-overflow-scrolling:touch;touch-action:pan-y;}' +
      '.pdfv-pages{display:flex;flex-direction:column;align-items:center;padding:0 0 40px;}' +
      '.pdfv-page{position:relative;background:#161010;overflow:hidden;flex-shrink:0;}' +
      '.pdfv-canvas{display:block;width:100%;height:100%;pointer-events:none;background:#fff;}' +
      '.pdfv-page-error{display:flex;align-items:center;justify-content:center;height:100%;' +
      'color:#ffb066;font-family:"Exo 2",sans-serif;font-size:12px;text-align:center;padding:12px;}' +
      '.pdfv-hud{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);' +
      'background:rgba(15,8,3,0.75);border:1px solid rgba(255,153,51,0.4);color:#ffb066;' +
      'font-family:"Exo 2",sans-serif;font-size:12px;letter-spacing:0.03em;padding:6px 16px;' +
      'border-radius:999px;pointer-events:none;opacity:0;transition:opacity 0.4s ease;z-index:5;}' +
      '.pdfv-hud.pdfv-show{opacity:1;}' +
      '.pdfv-loading{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;' +
      'align-items:center;justify-content:center;background:#0b0704;z-index:10;padding:24px;}' +
      '.pdfv-load-label{color:#ff9933;font-family:"Orbitron",sans-serif;font-size:12px;' +
      'letter-spacing:0.1em;}' +
      '.pdfv-load-track{width:min(220px,70%);height:6px;border-radius:999px;background:#2a1a10;' +
      'overflow:hidden;}' +
      '.pdfv-load-fill{width:0%;height:100%;border-radius:999px;' +
      'background:linear-gradient(90deg,#ff6a00,#ffb347);transition:width 0.15s ease-out;}' +
      '.pdfv-load-indeterminate .pdfv-load-fill{width:40%!important;' +
      'animation:pdfv-indeterminate 1.1s ease-in-out infinite;}' +
      '@keyframes pdfv-indeterminate{0%{margin-left:-40%;}100%{margin-left:100%;}}' +
      '.pdfv-load-pct{color:#ffb066;font-family:"Exo 2",sans-serif;font-size:12px;' +
      'letter-spacing:0.04em;min-height:14px;}' +
      '.pdfv-error{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;' +
      'align-items:center;justify-content:center;background:#0b0704;color:#ffb066;' +
      'font-family:"Exo 2",sans-serif;font-size:14px;text-align:center;padding:24px;}' +
      '.pdfv-retry{font-family:"Orbitron",sans-serif;font-size:12px;letter-spacing:0.06em;' +
      'background:linear-gradient(135deg,#ff6a00,#ffb347);border:none;color:#1a0d00;' +
      'padding:10px 22px;border-radius:999px;cursor:pointer;}';
    document.head.appendChild(style);
  }
})();
