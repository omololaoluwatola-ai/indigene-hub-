// ==========================================================
// INDIGENE Study Console — PWA Install Button Logic
// Drop this file in the repo root as install.js
// Link it in every page's <head> or before </body>:
// <script src="install.js" defer></script>
// ==========================================================

document.addEventListener('DOMContentLoaded', () => {
  const installBtn = document.getElementById('installBtn');
  if (!installBtn) return; // page has no install button, skip safely

  installBtn.style.display = 'none'; // hidden by default

  // Detect if already running as an installed PWA
  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true; // iOS Safari check
  }

  if (isInstalled()) {
    installBtn.style.display = 'none';
  }

  let deferredPrompt;

  // Chrome/Edge/Samsung Internet fire this when the site becomes installable
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!isInstalled()) {
      installBtn.style.display = 'inline-block';
    }
  });

  // User taps the custom install button
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none'; // hide immediately regardless of outcome
  });

  // Fires the moment install actually completes
  window.addEventListener('appinstalled', () => {
    installBtn.style.display = 'none';
    deferredPrompt = null;
  });
});
