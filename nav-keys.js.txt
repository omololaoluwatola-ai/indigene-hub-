/* INDIGENE nav-keys.js
 * Keyboard shortcuts + back-button / Escape handling for CBTs, mocks and PDFs.
 * Self-installing: load once from protect.js, nothing to add per page.
 * Optional override per page: <meta name="ix-mode" content="cbt|mock|pdf|none">
 */
(function () {
  'use strict';
  if (window.__ixNav) return;
  window.__ixNav = true;

  /* ---------- page mode ---------- */
  function detectMode() {
    var m = document.querySelector('meta[name="ix-mode"]');
    if (m && m.content) return m.content.toLowerCase();
    if (window.INDIGENE_NAV_MODE) return String(window.INDIGENE_NAV_MODE).toLowerCase();
    var p = location.pathname.toLowerCase();
    if (/pdfview|\/pdf/.test(p)) return 'pdf';
    if (/mock/.test(p)) return 'mock';
    if (/cbts?\/|cbt|past|pq/.test(p)) return 'cbt';
    return 'none';
  }
  var MODE = detectMode();
  if (MODE === 'none') return;

  var directOpen = history.length <= 1; // no page to go back to
  var leaving = false;

  /* ---------- helpers ---------- */
  function visible(el) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest && el.closest('[data-ixnav]')) return false;
    if (!el.getClientRects().length) return false;
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function txt(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  var CLICKABLE = 'button,[role="button"],[onclick],a,.btn,.opt,.option,.choice,label,li';
  function findBtn(re) {
    var list = document.querySelectorAll(CLICKABLE);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;
      var t = txt(el);
      if (t.length < 60 && re.test(t)) return el;
    }
    return null;
  }
  function click(el) { if (el) { el.click(); return true; } return false; }

  var RE_NEXT = /(^|\s)next\b|^finish\s*▶|finish\s*▶$/i;
  var RE_PREV = /\bprev(ious)?\b/i;
  var RE_MAP = /^map$/i;
  var RE_FINISH = /finish\s*(&|and)\s*see|^submit|submit\s*(exam|test|now)?$/i;
  var RE_CLOSE = /^(close|go back|stay|cancel|✕|×)$/i;

  function quizActive() {
    return !!(findBtn(RE_NEXT) || findBtn(RE_PREV) || findBtn(RE_MAP) || findBtn(RE_FINISH));
  }

  function optionByLetter(letter) {
    var list = document.querySelectorAll(CLICKABLE);
    var hits = [];
    var re = new RegExp('^\\(?' + letter + '[\\.\\):\\-\\s]', 'i');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;
      var t = txt(el);
      var lead = el.firstElementChild && txt(el.firstElementChild);
      var byBadge = lead && lead.length === 1 && lead.toUpperCase() === letter;
      if (t.length > 400 || !(byBadge || re.test(t))) continue;
      hits.push(el);
    }
    // keep innermost matches (drop wrappers that contain another hit)
    hits = hits.filter(function (a) {
      return !hits.some(function (b) { return b !== a && a.contains(b); });
    });
    return hits[0] || null;
  }
  function optionTF(word) {
    var list = document.querySelectorAll(CLICKABLE);
    var re = new RegExp('^' + word + '\\b', 'i');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!visible(el)) continue;
      if (re.test(txt(el)) && txt(el).length < 120) return el;
    }
    return null;
  }

  /* ---------- leave overlay ---------- */
  var overlay = null;
  function closeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }
  function btn(label, bg, fg, fn) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;margin:8px 0 0;padding:13px 14px;border-radius:10px;' +
      'border:1px solid #ff6a1a;font-family:inherit;font-weight:600;font-size:15px;cursor:pointer;background:' + bg + ';color:' + fg;
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    return b;
  }
  function goBackOut() {
    leaving = true;
    closeOverlay();
    if (directOpen) { location.href = '/index.html'; return; }
    history.go(-2); // skip the guard entry
    setTimeout(function () { location.href = '/index.html'; }, 600);
  }
  function showLeave() {
    if (overlay) return;
    var isMock = MODE === 'mock';
    overlay = document.createElement('div');
    overlay.setAttribute('data-ixnav', '1');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.82);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;';
    var card = document.createElement('div');
    card.style.cssText = 'max-width:340px;width:100%;background:#14100d;color:#fff;border:1px solid #ff6a1a;' +
      'border-radius:14px;padding:20px;font-family:inherit;text-align:center';
    var h = document.createElement('div');
    h.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:6px';
    h.textContent = isMock ? 'Leave the exam?' : 'Leave this CBT?';
    var p = document.createElement('div');
    p.style.cssText = 'font-size:14px;opacity:.85;line-height:1.4';
    p.textContent = isMock
      ? 'Your exam is still running. Submit to see your score, or stay and continue.'
      : 'Your progress in this run will be lost. You can finish and see your score instead.';
    card.appendChild(h); card.appendChild(p);
    card.appendChild(btn('Stay', '#ff6a1a', '#000', closeOverlay));
    card.appendChild(btn(isMock ? 'Submit' : 'Finish & see score', '#1d1813', '#ffd27a', function () {
      closeOverlay();
      var f = findBtn(RE_FINISH) || findBtn(/^finish\b/i);
      click(f);
    }));
    if (!isMock) card.appendChild(btn('Leave', '#1d1813', '#fff', goBackOut));
    overlay.appendChild(card);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOverlay(); });
    document.body.appendChild(overlay);
  }

  /* ---------- back button ---------- */
  function pushGuard() {
    try { history.pushState({ ixGuard: 1 }, '', location.href); } catch (e) {}
  }
  if (MODE === 'pdf') {
    if (directOpen) pushGuard();
  } else {
    pushGuard();
  }
  window.addEventListener('popstate', function () {
    if (leaving) return;
    if (MODE === 'pdf') {
      if (directOpen) { leaving = true; location.replace('/index.html'); }
      return;
    }
    if (quizActive()) {
      pushGuard();
      showLeave();
    } else {
      leaving = true;
      if (directOpen) location.replace('/index.html');
      else history.back();
    }
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var t = e.target;
    if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return;
    var k = e.key;

    if (k === 'Escape') {
      if (overlay) { closeOverlay(); e.preventDefault(); return; }
      var c = findBtn(RE_CLOSE);
      if (c) { c.click(); e.preventDefault(); return; }
      e.preventDefault();
      if (MODE === 'pdf') {
        if (directOpen) location.href = '/index.html'; else history.back();
      } else if (quizActive()) {
        showLeave();
      } else {
        if (directOpen) location.href = '/index.html'; else history.back();
      }
      return;
    }

    if (MODE === 'pdf' || overlay) return;
    var u = (k || '').toLowerCase();
    var target = null;

    if (u === 'n') target = findBtn(RE_NEXT);
    else if (u === 'p') target = findBtn(RE_PREV);
    else if (u === 'm') target = findBtn(RE_MAP);
    else if (u === 't') target = optionTF('true') || optionByLetter('t');
    else if (u === 'f') target = optionTF('false') || optionByLetter('f');
    else if (/^[a-e]$/.test(u)) target = optionByLetter(u.toUpperCase());

    if (target) { e.preventDefault(); target.click(); }
  });
})();
