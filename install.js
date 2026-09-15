// INDIGENE — PWA install button
// Fully self-contained: injects its own styled bar + logic. No edits needed anywhere
// else — this file being linked via <script src="install.js"></script> is enough.
//
// Same install pattern as the rest of the INDIGENE/F.A.S.P.A.S family:
//   - Shows immediately on load, doesn't wait around for Chrome's own delayed prompt
//   - Fires the real install prompt the instant it's tapped (or the moment Chrome's
//     ready, if tapped a split-second early)
//   - Handles iPhone separately (no one-tap install on iOS Safari)
//   - Disappears the moment the app is actually installed, stays gone after that

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
    #indigeneInstallBar button{
      background:var(--void, #07050a); color:var(--gold, #e8b84b); border:none; border-radius:7px;
      padding:10px 15px; font-family:'Orbitron', sans-serif; font-weight:700; font-size:0.74rem;
      letter-spacing:0.03em; cursor:pointer; white-space:nowrap; flex-shrink:0;
      transition:transform .12s ease;
    }
    #indigeneInstallBar button:active{ transform:scale(0.93); }
  `;
  document.head.appendChild(style);

  // ---------- inject markup ----------
  const bar = document.createElement('div');
  bar.id = 'indigeneInstallBar';
  bar.innerHTML = `
    <div class="ii-mark">◆</div>
    <div class="ii-text">
      <div class="ii-title" id="iiTitle">Install INDIGENE</div>
      <div class="ii-sub" id="iiSub">WORKS OFFLINE · OPENS LIKE A REAL APP</div>
    </div>
    <button id="iiBtn">Install</button>
  `;
  document.body.appendChild(bar);

  const btn = document.getElementById('iiBtn');
  const titleEl = document.getElementById('iiTitle');
  const subEl = document.getElementById('iiSub');

  if (isIOS()) {
    titleEl.textContent = 'Add INDIGENE to Home Screen';
    subEl.textContent = 'TAP SHARE, THEN "ADD TO HOME SCREEN"';
    btn.textContent = 'How?';
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
    if (isIOS()) {
      alert('On iPhone/iPad:\n1. Tap the Share icon in Safari\n2. Scroll down and tap "Add to Home Screen"\n3. Tap "Add"');
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
