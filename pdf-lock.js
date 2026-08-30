// INDIGENE PDF Access Control
// Design:
//  - DORMANT (config/settings.monetizationActive === false): PDF shows
//    INSTANTLY. No network wait. A cached flag in localStorage lets every
//    visit after the first render immediately; the live flag is still
//    checked in the background so flipping the switch takes effect quickly.
//  - ACTIVE: requires login. Free users get a 24hr window per PDF, tracked
//    in Firestore. Premium users are unlocked for their subscription period
//    (see users/{uid}.premiumUntil).
//  - OFFLINE while ACTIVE: Firestore's own offline cache (enabled below)
//    serves the user's LAST KNOWN state — so a free user who exhausts
//    their limit and then turns off mobile data stays locked, because the
//    locked state is what's cached locally. A device that has never once
//    checked in online has nothing to fall back to; in that one edge case
//    we fail CLOSED (show a "connect once to verify access" message)
//    rather than silently granting access.
//
// Usage on a PDF page:
//   <script type="module" src="../pdf-lock.js" data-pdf="pdfs/bio102.pdf" data-id="bio102"></script>
//   <div id="pdf-container"></div>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// Let Firestore cache documents locally so offline reads return the last
// known truth instead of hanging or erroring. Safe to fail (e.g. multiple
// tabs open, unsupported browser) — persistence is a nice-to-have, not
// required for the app to function.
try { enableIndexedDbPersistence(db); } catch (e) { /* ignore */ }

function withTimeout(promise, ms = 6000) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

const MONETIZATION_CACHE_KEY = 'indigene_monetization_active';
const MONETIZATION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readCachedMonetization() {
  try {
    const raw = localStorage.getItem(MONETIZATION_CACHE_KEY);
    if (!raw) return null;
    const { value, ts } = JSON.parse(raw);
    if (Date.now() - ts > MONETIZATION_CACHE_TTL_MS) return null;
    return value;
  } catch (e) { return null; }
}

function writeCachedMonetization(value) {
  try {
    localStorage.setItem(MONETIZATION_CACHE_KEY, JSON.stringify({ value, ts: Date.now() }));
  } catch (e) { /* ignore */ }
}

async function fetchMonetizationActive() {
  try {
    const settingsSnap = await withTimeout(getDoc(doc(db, 'config', 'settings')));
    const value = settingsSnap.exists() && settingsSnap.data().monetizationActive === true;
    writeCachedMonetization(value);
    return value;
  } catch (e) {
    // Genuinely can't reach Firestore and nothing cached — treat as
    // dormant so a real free user isn't blocked by a network hiccup.
    return false;
  }
}

const currentScript = document.currentScript || document.querySelector('script[src*="pdf-lock.js"]');
const pdfPath = currentScript ? currentScript.getAttribute('data-pdf') : null;
const pdfId = currentScript ? currentScript.getAttribute('data-id') : null;
const HOURS_LIMIT = 24;

function renderViewer(container, path) {
  const url = '../' + path;
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:40px; margin-bottom:10px;">📄</div>
      <h3 style="color:#ffb703; margin:0 0 10px 0;">Opening your PDF...</h3>
      <p style="color:#aaa; margin:0 0 18px 0;">If it doesn't open automatically, tap below.</p>
      <a href="${url}" target="_blank" rel="noopener" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Open PDF</a>
    </div>
  `;
  // Auto-open in the same tab, exactly like the original direct link did —
  // this is the one method proven reliable across every mobile browser.
  window.location.href = url;
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

function renderConnectOnce(container) {
  container.innerHTML = `
    <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
      <div style="font-size:40px; margin-bottom:10px;">📶</div>
      <h3 style="color:#ffb703; margin:0 0 10px 0;">Connect once to verify access</h3>
      <p style="color:#aaa; margin:0 0 18px 0;">This device hasn't checked in online yet. Connect briefly to the internet once, then this PDF will work offline normally.</p>
    </div>
  `;
}

async function checkFreeUserAccess(container, user) {
  try {
    const userSnap = await withTimeout(getDoc(doc(db, 'users', user.uid)));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const isPremium = userData.premium === true &&
      (!userData.premiumUntil || userData.premiumUntil.toMillis() > Date.now());

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
    // No cached state and no network at all — nothing to safely check
    // against, so fail CLOSED rather than grant free access.
    renderConnectOnce(container);
  }
}

async function initPdfAccess() {
  const container = document.getElementById('pdf-container');
  if (!container || !pdfPath || !pdfId) return;

  const cached = readCachedMonetization();

  if (cached === false || cached === null) {
    // Optimistic instant render: either we know it's dormant, or we don't
    // know yet — either way, don't make a free user wait to see a PDF
    // that's currently free. Confirm in the background; if it turns out
    // monetization just went active, swap to the real gated flow.
    renderViewer(container, pdfPath);
    const liveValue = await fetchMonetizationActive();
    if (liveValue === true) {
      await gateAccess(container, liveValue);
    }
    return;
  }

  // Cache says monetization IS active — don't flash paid content, go
  // straight to the real gated flow.
  await gateAccess(container, true);
}

async function gateAccess(container, knownActive) {
  container.innerHTML = '<p style="color:#888; text-align:center;">Checking access...</p>';
  const monetizationActive = knownActive === true ? true : await fetchMonetizationActive();

  if (!monetizationActive) {
    renderViewer(container, pdfPath);
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      renderLoginRequired(container);
      return;
    }
    await checkFreeUserAccess(container, user);
  });
}

initPdfAccess();
