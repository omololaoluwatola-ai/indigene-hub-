// INDIGENE install bar: a slim strip at the very top of the page.
// One file, linked with <script src="install.js"></script>. Nothing else to edit.
// - Android / laptop: the Install button opens the real install prompt.
// - iPhone / iPad: shows the Add to Home Screen steps.
// - Hidden once the app is installed. The X hides it for 3 days.
(function () {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  var iosBrowser = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var HIDE_KEY = 'indigene_install_hide';
  var hidden = false;
  try { hidden = Date.now() - Number(localStorage.getItem(HIDE_KEY) || 0) < 3 * 24 * 3600 * 1000; } catch (e) {}

  var css = document.createElement('style');
  css.textContent =
    '#indigeneInstallBar{position:relative;z-index:60;display:flex;align-items:center;gap:10px;height:40px;padding:0 8px 0 12px;' +
    'background:linear-gradient(90deg,rgba(255,122,26,.20),rgba(255,122,26,.06) 70%,rgba(255,122,26,.02));' +
    'border-bottom:1px solid rgba(255,122,26,.28);font-family:var(--body,system-ui,sans-serif);color:var(--parchment,#f2e6d8);animation:iiDrop .45s ease both;}' +
    '#indigeneInstallBar::after{content:"";position:absolute;left:0;bottom:-1px;height:1px;width:38%;background:linear-gradient(90deg,transparent,#ffb020,transparent);animation:iiSweep 3.2s ease-in-out infinite;}' +
    '@keyframes iiDrop{from{transform:translateY(-100%);opacity:0}to{transform:none;opacity:1}}' +
    '@keyframes iiSweep{0%{left:-40%}100%{left:100%}}' +
    '#indigeneInstallBar img{width:22px;height:22px;border-radius:6px;flex-shrink:0;display:block;}' +
    '#indigeneInstallBar .ii-t{flex:1;min-width:0;font-size:.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '#indigeneInstallBar .ii-t b{font-weight:600;color:var(--gold,#e8b84b);}' +
    '#indigeneInstallBar .ii-t i{font-style:normal;color:var(--ash-dim,#7a6a5d);margin-left:6px;font-size:.72rem;}' +
    '#indigeneInstallBar .ii-go{flex-shrink:0;height:26px;padding:0 14px;border:none;border-radius:999px;cursor:pointer;font-weight:700;font-size:.74rem;letter-spacing:.03em;color:#fff;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));box-shadow:0 0 12px rgba(255,122,26,.35);}' +
    '#indigeneInstallBar .ii-go:active{transform:scale(.94)}' +
    '#indigeneInstallBar .ii-x{flex-shrink:0;width:30px;height:30px;border:none;background:transparent;color:var(--ash-dim,#7a6a5d);font-size:1rem;line-height:1;cursor:pointer;}' +
    '@media (max-width:340px){#indigeneInstallBar .ii-t i{display:none}}' +
    '#iiModalOverlay{position:fixed;inset:0;z-index:10000;background:rgba(7,5,10,.82);display:flex;align-items:flex-end;justify-content:center;}' +
    '#iiModal{width:100%;max-width:420px;background:var(--char,#120b09);border:1px solid rgba(255,122,26,.3);border-radius:16px 16px 0 0;padding:24px 22px calc(24px + env(safe-area-inset-bottom));color:var(--ash,#a89484);font-family:var(--body,system-ui,sans-serif);position:relative;}' +
    '@media (min-width:560px){#iiOverlayFix,#iiModalOverlay{align-items:center}#iiModal{border-radius:16px}}' +
    '#iiModal h3{font-family:var(--display,inherit);font-weight:900;font-size:1.5rem;color:var(--parchment,#f2e6d8);text-transform:uppercase;margin-bottom:14px;line-height:1}' +
    '#iiModal ol{list-style:none;display:flex;flex-direction:column;gap:12px;margin:0;padding:0}' +
    '#iiModal li{display:flex;gap:12px;font-size:.9rem;line-height:1.4}' +
    '#iiModal li b{color:var(--gold,#e8b84b)}' +
    '#iiModal .n{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));color:#fff;font-weight:700;font-size:.75rem;display:flex;align-items:center;justify-content:center}' +
    '#iiModal .ok{width:100%;margin-top:20px;min-height:44px;border:none;border-radius:999px;color:#fff;font-weight:700;background:linear-gradient(135deg,var(--ember,#ff7a1a),var(--ember-deep,#8a2c0c));cursor:pointer}';
  document.head.appendChild(css);

  function showIOS() {
    var o = document.createElement('div'); o.id = 'iiModalOverlay';
    o.innerHTML = '<div id="iiModal" role="dialog" aria-modal="true"><h3>Add to Home Screen</h3><ol>' +
      '<li><span class="n">1</span><span>Tap the <b>Share</b> button in Safari.</span></li>' +
      '<li><span class="n">2</span><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>' +
      '<li><span class="n">3</span><span>Tap <b>Add</b> at the top right.</span></li></ol><button class="ok" type="button">Got it</button></div>';
    document.body.appendChild(o);
    var close = function () { o.remove(); };
    o.querySelector('.ok').onclick = close;
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
  }

  var deferred = null, bar = null, go = null, waiting = false;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    if (waiting) { waiting = false; run(); }
  });
  function removeBar() { if (bar) { bar.remove(); bar = null; } }
  async function run() {
    if (iosBrowser) return showIOS();
    if (!deferred) {
      if (go) { go.textContent = 'One moment'; setTimeout(function () { if (go) go.textContent = 'Install'; }, 5000); }
      waiting = true; return;
    }
    deferred.prompt();
    var c = await deferred.userChoice; deferred = null;
    if (c && c.outcome === 'accepted') removeBar();
  }
  window.indigeneInstall = run;
  window.addEventListener('appinstalled', function () { deferred = null; removeBar(); });

  function build() {
    if (hidden || !document.body) return;
    bar = document.createElement('div'); bar.id = 'indigeneInstallBar';
    bar.innerHTML = '<img src="icon-192.png" alt="">' +
      '<div class="ii-t"><b>' + (iosBrowser ? 'Add INDIGENE to your Home Screen' : 'Install INDIGENE') + '</b><i>works offline</i></div>' +
      '<button class="ii-go" type="button">' + (iosBrowser ? 'How?' : 'Install') + '</button>' +
      '<button class="ii-x" type="button" aria-label="Hide for now">✕</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    go = bar.querySelector('.ii-go'); go.addEventListener('click', run);
    bar.querySelector('.ii-x').addEventListener('click', function () {
      try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch (e) {}
      removeBar();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
