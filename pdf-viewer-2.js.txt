/* ============================================================
   INDIGENE PDF VIEWER
   Free, in-page, canvas-only PDF reader. No lock, no download
   path, no native PDF-reader handoff — nothing but this script
   ever points at the raw PDF file.

   Wire it into a pdfview/{id}.html page like this:
     <div id="pdf-container" data-pdf="../pdfs/x.pdf" data-id="x"></div>
     <script src="../pdf-viewer.js"></script>

   If your existing pages currently load "../pdf-lock.js", change
   that one line to "../pdf-viewer.js" — nothing else on the page
   needs to change.

   Features:
     - Continuous vertical scroll through the whole document
       (native momentum scrolling, not paged/swipe navigation).
     - Pinch to zoom (up to 3x), single-finger drag to pan while
       zoomed in. No on-screen zoom icons.
     - Each page is rendered once at high resolution up front, so
       zooming is just the browser scaling a sharp image — nothing
       to re-render, nothing to get stuck mid-gesture.
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
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 3;
  var MAX_CANVAS_W = 2200; // memory guard on low-end phones

  var container = document.getElementById('pdf-container');
  if (!container) return;

  var pdfUrl = container.dataset.pdf;
  var pdfId = container.dataset.id;
  if (!pdfUrl || !pdfId) {
    showError(container, 'This page is missing its PDF reference.');
    return;
  }

  // always full-screen: this covers the whole viewport regardless of
  // whatever header/topbar markup the host page has above it
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

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
  var pageBaseHeights = []; // each page's natural height at zoomLevel 1
  var pageHeightPx = 0; // uniform placeholder guess before a page's real height is known
  var pageGap = 10;
  var baseWidth = 0;
  var zoomLevel = 1;

  requestWakeLock();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') requestWakeLock();
    else releaseWakeLock();
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
      attachGestures();
      restoreScrollPosition();
      flashHud('Page 1 of ' + pageCount);
    })
    .catch(function () {
      showError(container, 'Could not open this PDF. Check your connection and try again.');
    });

  // ---------- layout ----------
  function buildPageSlots(firstPage) {
    var vp1 = firstPage.getViewport({ scale: 1 });
    baseWidth = Math.max(scroller.clientWidth - 4, 280);
    var fitScale = baseWidth / vp1.width;
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
      pageBaseHeights.push(pageHeightPx);
    }
  }

  function renderPage(num) {
    var div = pageDivs[num - 1];
    if (!div || div.dataset.rendered) return;
    div.dataset.rendered = 'pending';

    pdfDoc.getPage(num).then(function (page) {
      var vp1 = page.getViewport({ scale: 1 });
      var fitScale = baseWidth / vp1.width;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var renderScale = fitScale * dpr * MAX_ZOOM;
      if (vp1.width * renderScale > MAX_CANVAS_W) {
        renderScale = MAX_CANVAS_W / vp1.width;
      }
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
        // estimate — correct it (scaled to the current zoom) without
        // disturbing scroll position
        var correctH = Math.round(viewport.height / (dpr * MAX_ZOOM));
        pageBaseHeights[num - 1] = correctH;
        var target = Math.round(correctH * zoomLevel);
        if (Math.abs(target - div.clientHeight) > 2) {
          var delta = target - div.clientHeight;
          var beforeScroll = scroller.scrollTop;
          div.style.height = target + 'px';
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

  // ---------- pinch zoom (Adobe-Reader style: anchored to the pinch
  // midpoint, not a fixed origin) + pan-when-zoomed ----------
  function attachGestures() {
    var pointers = {};
    var gestureActive = false;
    var startDist = 0, startZoom = 1, liveScale = 1;
    var anchorContentX = 0, anchorContentY = 0, anchorScreenX = 0, anchorScreenY = 0;
    var pan = null;

    scroller.style.touchAction = 'pan-y';

    scroller.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);

      if (ids.length === 2) {
        var pts = ids.map(function (id) { return pointers[id]; });
        gestureActive = true;
        startDist = dist(pts[0], pts[1]) || 1;
        startZoom = zoomLevel;
        liveScale = 1;
        pan = null;

        var mid = midpoint(pts[0], pts[1]);
        anchorScreenX = mid.x;
        anchorScreenY = mid.y;
        var pwRect = pagesWrap.getBoundingClientRect();
        // the exact content point currently under the fingers, in the
        // untransformed (currently-committed) layout's coordinates
        anchorContentX = mid.x - pwRect.left;
        anchorContentY = mid.y - pwRect.top;
      } else if (ids.length === 1 && zoomLevel > 1.02) {
        pan = { x: e.clientX, y: e.clientY, top: scroller.scrollTop, left: scroller.scrollLeft };
      }
    });

    scroller.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in pointers)) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);

      if (ids.length === 2 && gestureActive) {
        var pts = ids.map(function (id) { return pointers[id]; });
        var d = dist(pts[0], pts[1]) || 1;
        liveScale = d / startDist;
        var previewZoom = clamp(startZoom * liveScale, MIN_ZOOM, MAX_ZOOM);
        // scale live, centered exactly on the pinch midpoint — this is
        // the piece that was missing before ("top center" made it feel
        // inaccurate no matter where you actually pinched)
        pagesWrap.style.transformOrigin = anchorContentX + 'px ' + anchorContentY + 'px';
        pagesWrap.style.transform = 'scale(' + (previewZoom / zoomLevel) + ')';
      } else if (ids.length === 1 && pan) {
        var dx = e.clientX - pan.x;
        var dy = e.clientY - pan.y;
        scroller.scrollLeft = pan.left - dx;
        scroller.scrollTop = pan.top - dy;
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);

      if (ids.length < 2 && gestureActive) {
        gestureActive = false;
        var newZoom = clamp(startZoom * liveScale, MIN_ZOOM, MAX_ZOOM);
        commitZoom(newZoom, anchorContentX, anchorContentY, anchorScreenX, anchorScreenY);
      }
      if (ids.length === 0) pan = null;
    }
    scroller.addEventListener('pointerup', endPointer);
    scroller.addEventListener('pointercancel', endPointer);
  }

  function commitZoom(newZoom, anchorContentX, anchorContentY, anchorScreenX, anchorScreenY) {
    pagesWrap.style.transform = 'none';
    pagesWrap.style.transformOrigin = '';

    var ratio = newZoom / zoomLevel;
    zoomLevel = newZoom;

    var w = Math.round(baseWidth * zoomLevel);
    pageDivs.forEach(function (div, i) {
      div.style.width = w + 'px';
      div.style.height = Math.round((pageBaseHeights[i] || pageHeightPx) * zoomLevel) + 'px';
    });

    // let the resize above settle, then put the exact same content
    // point back under the same screen position — no jump, no guessing
    requestAnimationFrame(function () {
      var scrollerRect = scroller.getBoundingClientRect();
      var newContentX = anchorContentX * ratio;
      var newContentY = anchorContentY * ratio;
      scroller.scrollLeft = newContentX - (anchorScreenX - scrollerRect.left);
      scroller.scrollTop = newContentY - (anchorScreenY - scrollerRect.top);
      scroller.style.touchAction = zoomLevel > 1.02 ? 'none' : 'pan-y';
    });
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

  // ---------- helpers ----------
  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

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
      '.pdfv-root{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;min-height:0;' +
      'background:#0b0704;overflow:hidden;z-index:99999;' +
      '-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}' +
      '.pdfv-scroller{position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;}' +
      '.pdfv-pages{display:flex;flex-direction:column;align-items:center;padding:10px 0 40px;}' +
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
