// INDIGENE install bar: a slim strip at the very top of the page.
// One file, linked with <script src="install.js"></script>. Nothing else to edit.
// - Chrome / Edge / Brave / Samsung: the Install button opens the real install prompt.
// - If the prompt does not come, the button shows plain manual steps (no more waiting forever).
// - WhatsApp / Facebook / Instagram / UC / Opera Mini browsers cannot install: it says "open in Chrome".
// - iPhone / iPad: shows the Add to Home Screen steps.
// - Hidden once the app is installed. No close button: it stays until installed.
// - No sliding or sweeping animation, and the bar is added at once, so the page does not jump.
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  var ua = navigator.userAgent;
  var iosBrowser = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  var isMobile = /Android|Mobi|iPhone|iPad|iPod|Tablet/i.test(ua);
  // Browsers that cannot install a web app: in-app browsers, UC, Opera Mini, Firefox on a laptop
  var weak = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Telegram|Twitter|Snapchat|TikTok|musical_ly|Bytedance|MicroMessenger|Line\/|GSA\/|; wv\)|UCBrowser|UCWEB|Opera Mini|OPiOS/i.test(ua) ||
    (/Firefox/i.test(ua) && !isMobile);

  var css = document.createElement('style');
  css.textContent =
    '#indigeneInstallBar{position:relative;z-index:60;display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;' +
    'background:linear-gradient(90deg,rgba(255,122,26,.20),rgba(255,122,26,.06) 70%,rgba(255,122,26,.02));' +
    'border-bottom:1px solid rgba(255,122,26,.28);font-family:var(--body,system-ui,sans-serif);color:var(--parchment,#f2e6d8);}' +
    '#indigeneInstallBar img{width:22px;height:22px;border-radius:6px;flex-shrink:0;display:block;}' +
    '#indigeneInstallBar .ii-t{flex:1;min-width:0;font-size:.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '#indigeneInstallBar .ii-t b{font-weight:600;color:var(--gold,#e8b84b);}' +
    '#indigeneInstallBar .ii-t i{font-style:normal;color:var(--ash-dim,#7a6a5d);margin-left:6px;font-size:.72rem;}' +
    '#indigeneInstallBar .ii-go{flex-shrink:0;height:26px;padding:0 14px;border:none;border-radius:999px;cursor:pointer;font-weight:700;font-size:.74rem;letter-spacing:.03em;color:#fff;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));box-shadow:0 0 12px rgba(255,122,26,.35);}' +
    '#indigeneInstallBar .ii-go:active{transform:scale(.94)}' +
    '@media (max-width:340px){#indigeneInstallBar .ii-t i{display:none}}' +
    '#iiModalOverlay{position:fixed;inset:0;z-index:10000;background:rgba(7,5,10,.82);display:flex;align-items:flex-end;justify-content:center;}' +
    '#iiModal{width:100%;max-width:420px;background:var(--char,#120b09);border:1px solid rgba(255,122,26,.3);border-radius:16px 16px 0 0;padding:24px 22px calc(24px + env(safe-area-inset-bottom));color:var(--ash,#a89484);font-family:var(--body,system-ui,sans-serif);position:relative;}' +
    '@media (min-width:560px){#iiModalOverlay{align-items:center}#iiModal{border-radius:16px}}' +
    '#iiModal h3{font-family:var(--display,inherit);font-weight:900;font-size:1.5rem;color:var(--parchment,#f2e6d8);text-transform:uppercase;margin:0 0 14px;line-height:1}' +
    '#iiModal ol{list-style:none;display:flex;flex-direction:column;gap:12px;margin:0;padding:0}' +
    '#iiModal li{display:flex;gap:12px;font-size:.9rem;line-height:1.4}' +
    '#iiModal li b{color:var(--gold,#e8b84b)}' +
    '#iiModal .n{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));color:#fff;font-weight:700;font-size:.75rem;display:flex;align-items:center;justify-content:center}' +
    '#iiModal .note{margin:14px 0 0;font-size:.78rem;line-height:1.45;color:var(--ash-dim,#7a6a5d)}' +
    '#iiModal .ok{width:100%;margin-top:20px;min-height:44px;border:none;border-radius:999px;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));cursor:pointer}';
  document.head.appendChild(css);

  var GUIDES = {
    ios: {
      title: 'Add to Home Screen',
      steps: ['Tap the <b>Share</b> button in Safari.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b> at the top right.']
    },
    inappIOS: {
      title: 'Open in Safari',
      steps: ['Tap the <b>Share</b> or <b>⋯</b> button at the top or bottom.', 'Tap <b>Open in Safari</b>.', 'In Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.'],
      note: 'Apps like WhatsApp and Instagram cannot install INDIGENE from inside them.'
    },
    inapp: {
      title: 'Open in Chrome',
      steps: ['Tap the <b>⋮</b> menu (top right corner).', 'Tap <b>Open in Chrome</b> (or <b>Open in browser</b>).', 'In Chrome, tap <b>Install INDIGENE</b> on the bar.'],
      note: 'WhatsApp, Facebook, Instagram, UC Browser and Opera Mini cannot install INDIGENE. Chrome, Edge, Brave and Samsung Internet can.'
    },
    manualMobile: {
      title: 'Install INDIGENE',
      steps: ['Tap the <b>⋮</b> menu in Chrome (top right).', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).', 'Tap <b>Install</b>.'],
      note: 'Do not see it? You may be in a private tab, or INDIGENE is already installed. Open this page in normal Chrome and try again.'
    },
    manualDesktop: {
      title: 'Install INDIGENE',
      steps: ['Click the <b>install icon</b> at the right end of the address bar. Or open the <b>⋮</b> menu and choose <b>Cast, save and share</b>, then <b>Install INDIGENE</b>.', 'Click <b>Install</b>.'],
      note: 'Use Chrome or Edge in a normal window, not private. A school or office laptop may block installs.'
    }
  };

  function showSteps(kind) {
    var g = GUIDES[kind];
    if (!g || document.getElementById('iiModalOverlay')) return;
    var o = document.createElement('div'); o.id = 'iiModalOverlay';
    var li = '';
    for (var i = 0; i < g.steps.length; i++) li += '<li><span class="n">' + (i + 1) + '</span><span>' + g.steps[i] + '</span></li>';
    o.innerHTML = '<div id="iiModal" role="dialog" aria-modal="true"><h3>' + g.title + '</h3><ol>' + li + '</ol>' +
      (g.note ? '<p class="note">' + g.note + '</p>' : '') + '<button class="ok" type="button">Got it</button></div>';
    document.body.appendChild(o);
    var close = function () { o.remove(); };
    o.querySelector('.ok').onclick = close;
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
  }

  var deferred = null, bar = null, go = null, waiting = false, timer = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    if (waiting) { waiting = false; clearTimeout(timer); if (go) go.textContent = 'Install'; run(); }
  });
  function removeBar() { if (bar) { bar.remove(); bar = null; } }
  async function run() {
    if (iosBrowser) return showSteps(weak ? 'inappIOS' : 'ios');
    if (weak) return showSteps('inapp');
    if (!deferred) {
      if (waiting) return;
      waiting = true;
      if (go) go.textContent = 'One moment';
      clearTimeout(timer);
      // The prompt did not arrive: show manual steps instead of waiting forever
      timer = setTimeout(function () {
        if (!waiting) return;
        waiting = false;
        if (go) go.textContent = 'Install';
        showSteps(isMobile ? 'manualMobile' : 'manualDesktop');
      }, 2500);
      return;
    }
    deferred.prompt();
    var c = await deferred.userChoice; deferred = null;
    if (c && c.outcome === 'accepted') removeBar();
  }
  window.indigeneInstall = run;
  window.addEventListener('appinstalled', function () { deferred = null; removeBar(); });

  function build() {
    if (!document.body || document.getElementById('indigeneInstallBar')) return;
    var title = iosBrowser ? 'Add INDIGENE to your Home Screen' : 'Install INDIGENE';
    var sub = weak ? 'open in ' + (iosBrowser ? 'Safari' : 'Chrome') : 'works offline';
    var label = (iosBrowser || weak) ? 'How?' : 'Install';
    bar = document.createElement('div'); bar.id = 'indigeneInstallBar';
    bar.innerHTML = '<img src="icon-192.png" alt="">' +
      '<div class="ii-t"><b>' + title + '</b><i>' + sub + '</i></div>' +
      '<button class="ii-go" type="button">' + label + '</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    go = bar.querySelector('.ii-go'); go.addEventListener('click', run);
  }
  // This script sits at the end of <body>, so build at once: the bar is there before the page shows.
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
