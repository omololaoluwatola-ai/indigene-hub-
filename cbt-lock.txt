// INDIGENE CBT Access Control
// Handles: dormant/active monetization switch, 20/day question limit per user,
// daily reset, premium bypass.
//
// Usage on a CBT page (call this instead of loading your question array directly):
//
//   import { checkCbtAccess } from "../cbt-lock.js";
//   const gate = await checkCbtAccess("ana203-muscle-tissue");
//   if (gate.blocked) { showLockScreen(gate.reason); }
//   else { startQuizWithLimit(gate.questionsAllowedToday); } // e.g. Infinity if unlimited

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

const DAILY_LIMIT = 20;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function waitForUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

/**
 * Call this before starting a CBT. Returns:
 * { blocked: false, questionsAllowedToday: Infinity }         -> dormant or premium, full access
 * { blocked: false, questionsAllowedToday: <n>, usedToday: <n> } -> free tier, still has quota left
 * { blocked: true, reason: 'limit' }                          -> free tier, hit 20/day
 * { blocked: true, reason: 'login' }                          -> monetization active, not logged in
 */
export async function checkCbtAccess(cbtId) {
  let monetizationActive = false;
  try {
    const settingsSnap = await getDoc(doc(db, 'config', 'settings'));
    if (settingsSnap.exists()) {
      monetizationActive = settingsSnap.data().monetizationActive === true;
    }
  } catch (e) {
    monetizationActive = false;
  }

  // DORMANT: everyone gets unlimited access, no login required
  if (!monetizationActive) {
    return { blocked: false, questionsAllowedToday: Infinity };
  }

  // ACTIVE: requires login
  const user = await waitForUser();
  if (!user) {
    return { blocked: true, reason: 'login' };
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const isPremium = userSnap.exists() && userSnap.data().premium === true;
    if (isPremium) {
      return { blocked: false, questionsAllowedToday: Infinity };
    }

    const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
    const usageSnap = await getDoc(usageRef);
    const usedToday = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;

    if (usedToday >= DAILY_LIMIT) {
      return { blocked: true, reason: 'limit' };
    }

    return { blocked: false, questionsAllowedToday: DAILY_LIMIT, usedToday };
  } catch (e) {
    // Fail safe: don't lock out a real user on an error
    return { blocked: false, questionsAllowedToday: Infinity };
  }
}

/**
 * Call this once per question the user actually answers/views, only when
 * questionsAllowedToday was NOT Infinity (i.e. free tier, monetization active).
 * Increments today's counter in Firestore.
 */
export async function recordCbtQuestionUsed() {
  const user = auth.currentUser;
  if (!user) return;
  const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
  const usageSnap = await getDoc(usageRef);
  const current = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;
  await setDoc(usageRef, { count: current + 1, date: todayKey(), uid: user.uid });
}

export function renderCbtLockScreen(container, reason) {
  if (reason === 'login') {
    container.innerHTML = `
      <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
        <div style="font-size:40px; margin-bottom:10px;">🔑</div>
        <h3 style="color:#ffb703; margin:0 0 10px 0;">Please log in</h3>
        <p style="color:#aaa; margin:0 0 18px 0;">You need an INDIGENE account to take this CBT.</p>
        <a href="../login.html" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Log In</a>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
        <div style="font-size:40px; margin-bottom:10px;">🔒</div>
        <h3 style="color:#ffb703; margin:0 0 10px 0;">Daily limit reached (20/20)</h3>
        <p style="color:#aaa; margin:0 0 18px 0;">Upgrade to INDIGENE Premium for unlimited CBT access, or come back tomorrow for 20 more free questions.</p>
        <a href="../premium.html" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Upgrade Now</a>
      </div>
    `;
  }
}
