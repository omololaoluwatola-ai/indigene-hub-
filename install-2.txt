let deferredPrompt;

// Create the banner element dynamically so no HTML edits are needed
const banner = document.createElement('div');
banner.id = 'installBanner';
banner.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#111;color:#fff;padding:14px;text-align:center;z-index:9999;font-family:sans-serif;';
banner.innerHTML = `
  📲 Install INDIGENE Hub for offline access
  <button id="installBtn" style="margin-left:10px;padding:6px 14px;">Install</button>
  <button id="installDismiss" style="margin-left:6px;padding:6px 14px;">✕</button>
`;
document.body.appendChild(banner);

const installBtn = document.getElementById('installBtn');
const dismissBtn = document.getElementById('installDismiss');

function isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true
      || localStorage.getItem('pwaInstalled') === 'true';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isInstalled()) {
    banner.style.display = 'block';
  }
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    localStorage.setItem('pwaInstalled', 'true');
    banner.style.display = 'none';
  }
  deferredPrompt = null;
});

dismissBtn.addEventListener('click', () => {
  banner.style.display = 'none';
  // no flag set here — banner WILL return on reload/next visit until actually installed
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('pwaInstalled', 'true');
  banner.style.display = 'none';
});
