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
  var rotation = 0; // 0, 90, 180, 270 — whole-document rotation, Adobe-style
  var io = null; // current IntersectionObserver, recreated when scroll axis flips

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
      attachViewportReflow();
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
        // the canvas always keeps its natural (unrotated) proportions —
        // only the wrapper div's box swaps on rotation; the canvas just
        // spins on top of it via transform, never gets stretched
        canvas.style.width = Math.round(baseWidth * zoomLevel) + 'px';
        canvas.style.height = Math.round(vp1.height * fitScale * zoomLevel) + 'px';
        canvas.style.transform = 'rotate(' + rotation + 'deg)';
        div.appendChild(canvas);
        div.dataset.rendered = 'done';
        // real page height may differ slightly from the placeholder
        // estimate — correct it (scaled to the current zoom, and to the
        // current rotation's swapped axis if sideways) without disturbing
        // scroll position
        var correctH = Math.round(viewport.height / (dpr * MAX_ZOOM));
        pageBaseHeights[num - 1] = correctH;
        var sideways = (rotation === 90 || rotation === 270);
        var targetW = Math.round((sideways ? correctH : baseWidth) * zoomLevel);
        var targetH = Math.round((sideways ? baseWidth : correctH) * zoomLevel);
        if (Math.abs(targetH - div.clientHeight) > 2 || Math.abs(targetW - div.clientWidth) > 2) {
          var deltaV = targetH - div.clientHeight;
          var beforeScroll = scroller.scrollTop;
          div.style.width = targetW + 'px';
          div.style.height = targetH + 'px';
          if (!sideways && div.offsetTop < beforeScroll) scroller.scrollTop = beforeScroll + deltaV;
        }
      });
    }).catch(function () {
      div.dataset.rendered = 'failed';
      div.innerHTML = '<div class="pdfv-page-error">Page ' + num + ' couldn\u2019t render</div>';
    });
  }

  // reflows to the phone's current width/height whenever the viewport
  // changes — most commonly, turning the phone to landscape or back.
  // Doesn't touch rotation (that stays gesture-only, separate feature) —
  // this just refits the same pages to whatever screen shape you're
  // actually holding right now, keeping zoom and scroll position intact.
  function attachViewportReflow() {
    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(reflowToViewport, 150);
    });
  }

  function reflowToViewport() {
    if (!pageDivs.length) return;
    var sideways = (rotation === 90 || rotation === 270);
    var oldScrollW = scroller.scrollWidth || 1;
    var oldScrollH = scroller.scrollHeight || 1;
    var fracX = scroller.scrollLeft / oldScrollW;
    var fracY = scroller.scrollTop / oldScrollH;

    baseWidth = Math.max(scroller.clientWidth - 4, 280);

    pageDivs.forEach(function (div, i) {
      var w = Math.round((sideways ? (pageBaseHeights[i] || pageHeightPx) : baseWidth) * zoomLevel);
      var h = Math.round((sideways ? baseWidth : (pageBaseHeights[i] || pageHeightPx)) * zoomLevel);
      div.style.width = w + 'px';
      div.style.height = h + 'px';
      var canvas = div.querySelector('canvas');
      if (canvas) {
        canvas.style.width = Math.round(baseWidth * zoomLevel) + 'px';
        canvas.style.height = Math.round((pageBaseHeights[i] || pageHeightPx) * zoomLevel) + 'px';
      }
    });

    requestAnimationFrame(function () {
      scroller.scrollLeft = fracX * scroller.scrollWidth;
      scroller.scrollTop = fracY * scroller.scrollHeight;
    });
  }

  function attachObserver() {
    if (io) { io.disconnect(); }
    if (!('IntersectionObserver' in window)) {
      // fallback for very old browsers: just render everything
      for (var i = 1; i <= pageCount; i++) renderPage(i);
      return;
    }
    var vertical = (rotation === 0 || rotation === 180);
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          renderPage(parseInt(entry.target.dataset.page, 10));
        }
      });
    }, { root: scroller, rootMargin: vertical ? '1200px 0px' : '0px 1200px', threshold: 0.01 });
    pageDivs.forEach(function (div) { io.observe(div); });
  }

  // ---------- resume position ----------
  var saveTimer = null;
  scroller.addEventListener('scroll', function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveScrollPosition, 400);
  });

  function currentPage() {
    var unit = (rotation === 0 || rotation === 180)
      ? pageHeightPx + pageGap
      : baseWidth + pageGap;
    var offset = (rotation === 0 || rotation === 180) ? scroller.scrollTop : scroller.scrollLeft;
    return Math.min(pageCount, Math.max(1, Math.round(offset / unit) + 1));
  }
  function saveScrollPosition() {
    try {
      var vertical = (rotation === 0 || rotation === 180);
      var all = JSON.parse(localStorage.getItem('pdfv-progress') || '{}');
      all[pdfId] = {
        scroll: vertical ? scroller.scrollTop : scroller.scrollLeft,
        axis: vertical ? 'v' : 'h',
        rotation: rotation
      };
      localStorage.setItem('pdfv-progress', JSON.stringify(all));
    } catch (e) { /* private mode / storage full — resume just won't work this time */ }
  }
  function restoreScrollPosition() {
    try {
      var all = JSON.parse(localStorage.getItem('pdfv-progress') || '{}');
      var saved = all[pdfId];
      if (saved == null) return;
      if (typeof saved === 'number') {
        // older saved format, from before rotation existed — always vertical
        scroller.scrollTop = saved;
        flashHud('Resumed at page ' + currentPage());
        return;
      }
      if (saved.rotation) applyRotation(saved.rotation, true);
      if (saved.axis === 'h') scroller.scrollLeft = saved.scroll || 0;
      else scroller.scrollTop = saved.scroll || 0;
      flashHud('Resumed at page ' + currentPage());
    } catch (e) {}
  }

  // ---------- pinch zoom (anchored to the pinch midpoint) + twist to
  // rotate (Adobe-style whole-document rotate, snaps to 90°) + pan ----------
  var ROTATE_THRESHOLD = 25; // degrees of twist needed before it counts as "rotate", not zoom jitter
  var ROTATE_DEADZONE = 8;   // degrees of incidental twist during a normal pinch to ignore entirely

  function attachGestures() {
    var pointers = {};
    var gestureActive = false;
    var startDist = 0, startZoom = 1, liveScale = 1;
    var startAngle = 0, liveAngleDelta = 0;
    var anchorScreenX = 0, anchorScreenY = 0;
    var pan = null;

    scroller.style.touchAction = 'pan-y';

    scroller.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);

      if (ids.length === 2) {
        var pts = ids.map(function (id) { return pointers[id]; });
        gestureActive = true;
        startDist = dist(pts[0], pts[1]) || 1;
        startAngle = angleOf(pts[0], pts[1]);
        liveAngleDelta = 0;
        startZoom = zoomLevel;
        liveScale = 1;
        pan = null;

        var mid = midpoint(pts[0], pts[1]);
        anchorScreenX = mid.x;
        anchorScreenY = mid.y;
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

        var a = angleOf(pts[0], pts[1]);
        var raw = a - startAngle;
        while (raw > 180) raw -= 360;
        while (raw < -180) raw += 360;
        liveAngleDelta = raw;

        // ignore small incidental twist during an ordinary pinch — only
        // show rotation feedback once it's clearly deliberate, so a plain
        // zoom no longer visibly "tilts"
        var shownAngle = 0;
        if (Math.abs(liveAngleDelta) > ROTATE_DEADZONE) {
          shownAngle = liveAngleDelta - (liveAngleDelta > 0 ? ROTATE_DEADZONE : -ROTATE_DEADZONE);
        }

        var previewZoom = clamp(startZoom * liveScale, MIN_ZOOM, MAX_ZOOM);
        // scale live, centered exactly on the pinch midpoint, using screen
        // coordinates directly as the transform-origin — this avoids
        // measuring against pagesWrap's box at all, which is what caused
        // the jump-to-a-different-spot bug (that box recenters its
        // children when they resize, so it wasn't a stable reference point)
        var pwRect = pagesWrap.getBoundingClientRect();
        pagesWrap.style.transformOrigin =
          (anchorScreenX - pwRect.left) + 'px ' + (anchorScreenY - pwRect.top) + 'px';
        pagesWrap.style.transform =
          'scale(' + (previewZoom / zoomLevel) + ') rotate(' + shownAngle + 'deg)';
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
        commitZoom(newZoom, anchorScreenX, anchorScreenY);

        if (Math.abs(liveAngleDelta) >= ROTATE_THRESHOLD) {
          var step = liveAngleDelta > 0 ? 90 : -90;
          applyRotation(rotation + step);
          flashHud(((rotation) % 360 + 360) % 360 + '\u00b0');
        }
        liveAngleDelta = 0;
      }
      if (ids.length === 0) pan = null;
    }
    scroller.addEventListener('pointerup', endPointer);
    scroller.addEventListener('pointercancel', endPointer);
  }

  function commitZoom(newZoom, anchorScreenX, anchorScreenY) {
    pagesWrap.style.transform = 'none';
    pagesWrap.style.transformOrigin = '';

    // capture what fraction of the (old) scrollable area sits under the
    // pinch point BEFORE resizing anything — a fraction of scrollWidth/
    // scrollHeight is immune to the page-centering issue that broke the
    // old math, since it never depends on any single element's box
    var scrollerRect = scroller.getBoundingClientRect();
    var oldScrollW = scroller.scrollWidth || 1;
    var oldScrollH = scroller.scrollHeight || 1;
    var fracX = (scroller.scrollLeft + (anchorScreenX - scrollerRect.left)) / oldScrollW;
    var fracY = (scroller.scrollTop + (anchorScreenY - scrollerRect.top)) / oldScrollH;

    zoomLevel = newZoom;
    var sideways = (rotation === 90 || rotation === 270);

    pageDivs.forEach(function (div, i) {
      var w = Math.round((sideways ? (pageBaseHeights[i] || pageHeightPx) : baseWidth) * zoomLevel);
      var h = Math.round((sideways ? baseWidth : (pageBaseHeights[i] || pageHeightPx)) * zoomLevel);
      div.style.width = w + 'px';
      div.style.height = h + 'px';
      var canvas = div.querySelector('canvas');
      if (canvas) {
        canvas.style.width = Math.round(baseWidth * zoomLevel) + 'px';
        canvas.style.height = Math.round((pageBaseHeights[i] || pageHeightPx) * zoomLevel) + 'px';
      }
    });

    // let the resize above settle, then put the exact same fraction of
    // content back under the same screen position — no jump, no guessing
    requestAnimationFrame(function () {
      var newScrollerRect = scroller.getBoundingClientRect();
      var newScrollW = scroller.scrollWidth || 1;
      var newScrollH = scroller.scrollHeight || 1;
      scroller.scrollLeft = fracX * newScrollW - (anchorScreenX - newScrollerRect.left);
      scroller.scrollTop = fracY * newScrollH - (anchorScreenY - newScrollerRect.top);
      updateTouchAction();
    });
  }

  function updateTouchAction() {
    var vertical = (rotation === 0 || rotation === 180);
    if (zoomLevel > 1.02) scroller.style.touchAction = 'none';
    else scroller.style.touchAction = vertical ? 'pan-y' : 'pan-x';
  }

  // whole-document rotate, Adobe "Rotate View" style: flips which axis
  // scrolls (0/180 = vertical, 90/270 = horizontal), reflows every page's
  // box to the swapped aspect, and re-centers each page's canvas inside it
  function applyRotation(newRot, skipScrollRestore) {
    newRot = ((newRot % 360) + 360) % 360;
    var oldVertical = (rotation === 0 || rotation === 180);
    var newVertical = (newRot === 0 || newRot === 180);
    var axisChanged = oldVertical !== newVertical;

    var fractionBefore = 0;
    if (axisChanged && !skipScrollRestore) {
      fractionBefore = oldVertical
        ? (scroller.scrollHeight > 0 ? scroller.scrollTop / scroller.scrollHeight : 0)
        : (scroller.scrollWidth > 0 ? scroller.scrollLeft / scroller.scrollWidth : 0);
    }

    rotation = newRot;

    if (axisChanged) {
      pagesWrap.style.flexDirection = newVertical ? 'column' : 'row';
      var sideways = !newVertical;
      pageDivs.forEach(function (div, i) {
        var w = Math.round((sideways ? (pageBaseHeights[i] || pageHeightPx) : baseWidth) * zoomLevel);
        var h = Math.round((sideways ? baseWidth : (pageBaseHeights[i] || pageHeightPx)) * zoomLevel);
        div.style.width = w + 'px';
        div.style.height = h + 'px';
        div.style.marginBottom = newVertical ? pageGap + 'px' : '0';
        div.style.marginRight = newVertical ? '0' : pageGap + 'px';
      });
      attachObserver();
    }

    pageDivs.forEach(function (div) {
      var canvas = div.querySelector('canvas');
      if (canvas) canvas.style.transform = 'rotate(' + rotation + 'deg)';
    });

    if (axisChanged && !skipScrollRestore) {
      requestAnimationFrame(function () {
        if (newVertical) scroller.scrollTop = fractionBefore * scroller.scrollHeight;
        else scroller.scrollLeft = fractionBefore * scroller.scrollWidth;
        updateTouchAction();
      });
    } else {
      updateTouchAction();
    }
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
  function angleOf(a, b) { return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; }
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
      '.pdfv-page{position:relative;background:#161010;overflow:hidden;flex-shrink:0;' +
      'display:flex;align-items:center;justify-content:center;}' +
      '.pdfv-canvas{display:block;pointer-events:none;background:#fff;flex-shrink:0;}' +
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
