// INDIGENE PDF Access Control
// Handles: dormant/active monetization switch, embedded no-download viewer,
// 24hr free-access lock per PDF per user, premium bypass.
//
// Usage on a PDF page:
//   <script type="module" src="../pdf-lock.js" data-pdf="pdfs/bio102.pdf" data-id="bio102"></script>
//   <div id="pdf-container"></div>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7PzG9dzoGdp_eoNWVGpQIld_evqHOMls",
  authDomain: "indigene-hub.firebaseapp.com",
  projectId: "indigene-hub",
  storageBucket: "indigene-hub.firebasestorage.app",
  messagingSenderId: "839726253668",
  appId: "1:839726253668:web:b2ec508edb5c73f14a8171"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function withTimeout(promise, ms = 6000) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

const currentScript = document.currentScript || document.querySelector('script[src*="pdf-lock.js"]');
const pdfPath = currentScript ? currentScript.getAttribute('data-pdf') : null;
const pdfId = currentScript ? currentScript.getAttribute('data-id') : null;
const HOURS_LIMIT = 24;

function renderViewer(container, path) {
  container.innerHTML = `
    <div style="width:100%; height:85vh; border-radius:10px; overflow:hidden; border:1px solid #333;">
      <iframe src="../${path}#toolbar=0&navpanes=0&scrollbar=1" style="width:100%; height:100%; border:none;"></iframe>
    </div>
    <p style="color:#888; font-size:12px; text-align:center; margin-top:8px;">Viewing in-page — download disabled for free access.</p>
  `;
}

function renderLocked(container) {
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:40px; margin-bottom:10px;">🔒</div>
      <h3 style="color:#ffb703; margin:0 0 10px 0;">Free access window ended</h3>
      <p style="color:#aaa; margin:0 0 18px 0;">This PDF's 24-hour free view has expired. Upgrade to INDIGENE Premium for permanent access.</p>
      <a href="../premium.html" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Upgrade Now</a>
    </div>
  `;
}

function renderLoginRequired(container) {
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:40px; margin-bottom:10px;">🔑</div>
      <h3 style="color:#ffb703; margin:0 0 10px 0;">Please log in</h3>
      <p style="color:#aaa; margin:0 0 18px 0;">You need an INDIGENE account to view this PDF.</p>
      <a href="../login.html" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Log In</a>
    </div>
  `;
}

async function initPdfAccess() {
  const container = document.getElementById('pdf-container');
  if (!container || !pdfPath || !pdfId) return;

  container.innerHTML = '<p style="color:#888; text-align:center;">Loading...</p>';

  // Check master switch (with a timeout so a slow/unreachable network
  // can never leave the page stuck on "Loading..." forever)
  let monetizationActive = false;
  try {
    const settingsSnap = await withTimeout(getDoc(doc(db, 'config', 'settings')));
    if (settingsSnap.exists()) {
      monetizationActive = settingsSnap.data().monetizationActive === true;
    }
  } catch (e) {
    // Network too slow, offline, or settings doc missing — default to
    // inactive so the PDF still shows rather than hanging indefinitely.
    monetizationActive = false;
  }

  // DORMANT: monetization off — everyone gets full free access, no login needed
  if (!monetizationActive) {
    renderViewer(container, pdfPath);
    return;
  }

  // ACTIVE: monetization on — requires login
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      renderLoginRequired(container);
      return;
    }

    try {
      const userSnap = await withTimeout(getDoc(doc(db, 'users', user.uid)));
      const isPremium = userSnap.exists() && userSnap.data().premium === true;

      if (isPremium) {
        renderViewer(container, pdfPath);
        return;
      }

      const accessDocId = `${user.uid}_${pdfId}`;
      const accessRef = doc(db, 'pdfAccess', accessDocId);
      const accessSnap = await withTimeout(getDoc(accessRef));

      if (!accessSnap.exists()) {
        // First time viewing this PDF — start the 24hr clock
        await withTimeout(setDoc(accessRef, { firstOpened: serverTimestamp(), pdfId, uid: user.uid }));
        renderViewer(container, pdfPath);
        return;
      }

      const firstOpened = accessSnap.data().firstOpened;
      if (!firstOpened) {
        // Timestamp still resolving server-side, allow view
        renderViewer(container, pdfPath);
        return;
      }

      const hoursElapsed = (Date.now() - firstOpened.toMillis()) / (1000 * 60 * 60);
      if (hoursElapsed < HOURS_LIMIT) {
        renderViewer(container, pdfPath);
      } else {
        renderLocked(container);
      }
    } catch (e) {
      // Fail safe: on error, show the PDF rather than lock out a real user
      renderViewer(container, pdfPath);
    }
  });
}

initPdfAccess();
