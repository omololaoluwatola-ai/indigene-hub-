// INDIGENE — PWA install button
// Fully self-contained: injects its own styled bar + logic. No edits needed anywhere
// else — this file being linked via <script src="install.js"></script> is enough.
//
// - Shows immediately on load, doesn't wait around for Chrome's own delayed prompt
// - Fires the real install prompt the instant it's tapped (or the moment Chrome's
//   ready, if tapped a split-second early)
// - iPhone/iPad gets a themed step-by-step modal (no native browser install on iOS Safari)
// - Disappears the moment the app is actually installed, stays gone after that

(function () {
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  if (isStandalone()) return; // already installed — nothing to show, ever

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  // ---------- inject styles, matching INDIGENE's existing CSS variables exactly ----------
  const style = document.createElement('style');
  style.textContent = `
    #indigeneInstallBar{
      position:fixed; left:14px; right:14px; bottom:14px; z-index:9999;
      display:flex; align-items:center; gap:12px;
      background:linear-gradient(135deg, var(--ember, #ff7a1a), var(--ember-deep, #8a2c0c));
      border-radius:10px; padding:13px 15px;
      padding-bottom:calc(13px + env(safe-area-inset-bottom));
      box-shadow:0 10px 32px rgba(255,122,26,0.4), inset 0 1px 0 rgba(255,255,255,0.15);
      font-family:'Exo 2', sans-serif;
      animation:indigeneInstallRise .35s ease;
    }
    @keyframes indigeneInstallRise{
      from{ transform:translateY(24px); opacity:0; }
      to{ transform:translateY(0); opacity:1; }
    }
    #indigeneInstallBar .ii-mark{
      width:34px; height:34px; border-radius:8px; flex-shrink:0;
      background:var(--void, #07050a);
      display:flex; align-items:center; justify-content:center;
      font-family:'Orbitron', sans-serif; font-weight:900; font-size:1rem;
      color:var(--ember-hot, #ffb020);
    }
    #indigeneInstallBar .ii-text{ flex:1; min-width:0; }
    #indigeneInstallBar .ii-title{
      color:var(--void, #07050a); font-weight:700; font-size:0.85rem; line-height:1.3;
    }
    #indigeneInstallBar .ii-sub{
      color:rgba(7,5,10,0.68); font-size:0.68rem; letter-spacing:0.02em; margin-top:1px;
      font-family:'JetBrains Mono', monospace;
    }
    #indigeneInstallBar button.ii-action{
      background:var(--void, #07050a); color:var(--gold, #e8b84b); border:none; border-radius:7px;
      padding:10px 15px; font-family:'Orbitron', sans-serif; font-weight:700; font-size:0.74rem;
      letter-spacing:0.03em; cursor:pointer; white-space:nowrap; flex-shrink:0;
      transition:transform .12s ease;
    }
    #indigeneInstallBar button.ii-action:active{ transform:scale(0.93); }

    #iiModalOverlay{
      position:fixed; inset:0; z-index:10000; background:rgba(7,5,10,0.82);
      display:flex; align-items:flex-end; justify-content:center;
      animation:indigeneFadeIn .2s ease;
    }
    @keyframes indigeneFadeIn{ from{opacity:0;} to{opacity:1;} }
    @media (min-width:560px){
      #iiModalOverlay{ align-items:center; }
    }
    #iiModal{
      width:100%; max-width:420px; background:var(--char, #120b09);
      border:1px solid rgba(255,122,26,0.3); border-radius:16px 16px 0 0;
      padding:26px 22px calc(26px + env(safe-area-inset-bottom));
      font-family:'Exo 2', sans-serif; color:var(--ash, #a89484);
      box-shadow:0 -10px 40px rgba(0,0,0,0.5);
      animation:indigeneInstallRise .3s ease;
      position:relative;
    }
    @media (min-width:560px){
      #iiModal{ border-radius:16px; padding:26px 24px; }
    }
    #iiModal .ii-modal-close{
      position:absolute; top:14px; right:16px; background:transparent; border:none;
      color:var(--ash-dim, #5e4f43); font-size:1.3rem; cursor:pointer; line-height:1;
    }
    #iiModal h3{
      font-family:'Orbitron', sans-serif; font-weight:700; font-size:1.05rem;
      letter-spacing:0.03em; color:var(--parchment, #f2e6d8); margin-bottom:6px;
    }
    #iiModal .ii-modal-sub{
      font-family:'JetBrains Mono', monospace; font-size:0.64rem; letter-spacing:0.12em;
      text-transform:uppercase; color:var(--ember, #ff7a1a); margin-bottom:18px;
    }
    #iiModal ol{ list-style:none; display:flex; flex-direction:column; gap:14px; }
    #iiModal li{ display:flex; align-items:flex-start; gap:12px; font-size:0.86rem; line-height:1.4; }
    #iiModal .ii-step-num{
      flex-shrink:0; width:24px; height:24px; border-radius:50%;
      background:linear-gradient(135deg, var(--ember, #ff7a1a), var(--ember-deep, #8a2c0c));
      color:#fff; font-family:'JetBrains Mono', monospace; font-weight:700; font-size:0.72rem;
      display:flex; align-items:center; justify-content:center;
    }
    #iiModal .ii-step-text b{ color:var(--gold, #e8b84b); }
    #iiModal .ii-icon-inline{
      display:inline-flex; align-items:center; justify-content:center;
      width:20px; height:20px; border-radius:5px; background:rgba(255,122,26,0.12);
      color:var(--ember-hot, #ffb020); font-size:0.75rem; margin:0 2px; vertical-align:-4px;
    }
    #iiModal .ii-modal-gotit{
      width:100%; margin-top:22px; background:linear-gradient(135deg, var(--ember, #ff7a1a), var(--ember-deep, #8a2c0c));
      color:#fff; border:none; border-radius:8px; padding:13px; font-family:'Orbitron', sans-serif;
      font-weight:700; font-size:0.78rem; letter-spacing:0.04em; cursor:pointer;
    }
    #iiModal .ii-modal-gotit:active{ transform:scale(0.98); }
  `;
  document.head.appendChild(style);

  // ---------- inject bottom bar ----------
  const bar = document.createElement('div');
  bar.id = 'indigeneInstallBar';
  bar.innerHTML = `
    <div class="ii-mark">◆</div>
    <div class="ii-text">
      <div class="ii-title" id="iiTitle">Install INDIGENE</div>
      <div class="ii-sub" id="iiSub">WORKS OFFLINE · OPENS LIKE A REAL APP</div>
    </div>
    <button class="ii-action" id="iiBtn">Install</button>
  `;
  document.body.appendChild(bar);

  const btn = document.getElementById('iiBtn');
  const titleEl = document.getElementById('iiTitle');
  const subEl = document.getElementById('iiSub');

  const iosBrowser = isIOS();

  if (iosBrowser) {
    titleEl.textContent = 'Add INDIGENE to Home Screen';
    subEl.textContent = 'WORKS OFFLINE · OPENS LIKE A REAL APP';
    btn.textContent = 'How?';
  }

  // ---------- themed iOS instructions modal (replaces native alert) ----------
  function showIOSModal() {
    const overlay = document.createElement('div');
    overlay.id = 'iiModalOverlay';
    overlay.innerHTML = `
      <div id="iiModal" role="dialog" aria-modal="true">
        <button class="ii-modal-close" id="iiModalClose" aria-label="Close">✕</button>
        <h3>Add INDIGENE to Home Screen</h3>
        <div class="ii-modal-sub">iOS · Safari only</div>
        <ol>
          <li>
            <div class="ii-step-num">1</div>
            <div class="ii-step-text">Tap the <b>Share</b> icon <span class="ii-icon-inline">⬆</span> in the Safari toolbar.</div>
          </li>
          <li>
            <div class="ii-step-num">2</div>
            <div class="ii-step-text">Scroll down and tap <b>"Add to Home Screen."</b></div>
          </li>
          <li>
            <div class="ii-step-num">3</div>
            <div class="ii-step-text">Tap <b>Add</b> in the top right corner.</div>
          </li>
        </ol>
        <button class="ii-modal-gotit" id="iiModalGotIt">Got It</button>
      </div>
    `;
    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); }
    document.getElementById('iiModalClose').addEventListener('click', closeModal);
    document.getElementById('iiModalGotIt').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  }

  let deferredPrompt = null;
  let autoPromptOnceReady = false;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (autoPromptOnceReady) {
      autoPromptOnceReady = false;
      triggerInstall();
    }
  });

  async function triggerInstall() {
    if (iosBrowser) {
      showIOSModal();
      return;
    }
    if (!deferredPrompt) {
      btn.textContent = 'Preparing…';
      autoPromptOnceReady = true;
      setTimeout(() => { if (btn.textContent === 'Preparing…') btn.textContent = 'Install'; }, 6000);
      return;
    }
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (choice && choice.outcome === 'accepted') {
      bar.remove();
    }
  }

  btn.addEventListener('click', triggerInstall);

  window.addEventListener('appinstalled', () => {
    bar.remove();
    deferredPrompt = null;
  });
})();
