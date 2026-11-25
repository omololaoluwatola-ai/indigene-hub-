// INDIGENE CBT Access Control
// Design mirrors pdf-lock.js:
//  - DORMANT: instant access, no network wait (cached flag + optimistic
//    start; verified in the background).
//  - ACTIVE: requires login. Free users get 10 questions/day (resets at
//    local midnight). Premium users are unlimited for their subscription
//    period (users/{uid}.premiumUntil).
//  - OFFLINE while ACTIVE: Firestore's own offline cache (enabled below)
//    serves the user's LAST KNOWN state, so a free user who used up their
//    10 today and turns off mobile data stays locked. A device that has
//    never once checked in online has nothing to fall back to; in that one
//    edge case we fail CLOSED rather than silently granting access.
//
// Usage on a CBT page:
//
//   import { checkCbtAccess } from "../cbt-lock.js";
//   const gate = await checkCbtAccess("ana203-muscle-tissue");
//   if (gate.blocked) { showLockScreen(gate.reason); }
//   else { startQuizWithLimit(gate.questionsAllowedToday); } // Infinity if unlimited

// Premium is decided in ONE place: premium.js (premiumUnlocks/{email}, written by Paystack or by admin).
// Firebase is started once, by auth.js, and shared from there.
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db, isMonetizationActive, getPremiumState, waitForUser } from "./premium.js";

const DAILY_LIMIT = 10;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function withTimeout(promise, ms = 6000) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Call this before starting a CBT. Returns:
 * { blocked: false, questionsAllowedToday: Infinity }            -> dormant or premium, full access
 * { blocked: false, questionsAllowedToday: <n>, usedToday: <n> } -> free tier, still has quota left
 * { blocked: true, reason: 'limit' }                              -> free tier, hit 10/day
 * { blocked: true, reason: 'login' }                               -> monetization active, not logged in
 * { blocked: true, reason: 'offline' }                             -> active, never checked in online, no cache
 *
 * IMPORTANT: this function never THROWS on its own — it always resolves,
 * so a caller can safely `await` it without its own try/catch. A page
 * that wants to be extra defensive can still wrap the call, but it's not
 * required for correct behavior.
 */
export async function checkCbtAccess(cbtId) {
  // Switch off (dormant) = everything open. premium.js answers this from a 5-minute
  // saved copy, so nobody waits.
  let monetizationActive;
  try { monetizationActive = await isMonetizationActive(); } catch (e) { monetizationActive = false; }

  if (!monetizationActive) {
    return { blocked: false, questionsAllowedToday: Infinity };
  }

  const user = await waitForUser();
  if (!user) {
    return { blocked: true, reason: 'login' };
  }

  // One shared lock: premiumUnlocks/{email} (Paystack or admin) or an old users/{uid} premium plan.
  const ps = await getPremiumState();
  if (ps.premium) {
    return { blocked: false, questionsAllowedToday: Infinity };
  }
  if (ps.offline) {
    // No saved copy and no network: fail CLOSED rather than grant free access.
    return { blocked: true, reason: 'offline' };
  }

  try {
    const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
    const usageSnap = await withTimeout(getDoc(usageRef));
    const usedToday = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;

    if (usedToday >= DAILY_LIMIT) {
      return { blocked: true, reason: 'limit' };
    }

    return { blocked: false, questionsAllowedToday: DAILY_LIMIT, usedToday };
  } catch (e) {
    // No cached state and no network at all — nothing to safely check
    // against. Fail CLOSED rather than grant unlimited free access.
    return { blocked: true, reason: 'offline' };
  }
}

/**
 * Call this once per question the user actually answers/views, only when
 * questionsAllowedToday was NOT Infinity (i.e. free tier, monetization active).
 * Increments today's counter in Firestore. Non-blocking by design — never
 * throws, since a failed usage-count write should never interrupt the quiz.
 */
export async function recordCbtQuestionUsed() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
    const usageSnap = await withTimeout(getDoc(usageRef));
    const current = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;
    await withTimeout(setDoc(usageRef, { count: current + 1, date: todayKey(), uid: user.uid }));
  } catch (e) { /* non-blocking — never interrupt the quiz over a usage-count write */ }
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
  } else if (reason === 'offline') {
    container.innerHTML = `
      <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
        <div style="font-size:40px; margin-bottom:10px;">📶</div>
        <h3 style="color:#ffb703; margin:0 0 10px 0;">Connect once to verify access</h3>
        <p style="color:#aaa; margin:0 0 18px 0;">This device hasn't checked in online yet. Connect briefly to the internet once, then this CBT will work offline normally.</p>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div style="background:#161616; border-radius:12px; padding:30px 20px; text-align:center; color:#eee; font-family:-apple-system,sans-serif;">
        <div style="font-size:40px; margin-bottom:10px;">🔒</div>
        <h3 style="color:#ffb703; margin:0 0 10px 0;">Daily limit reached (10/10)</h3>
        <p style="color:#aaa; margin:0 0 18px 0;">Upgrade to INDIGENE Premium for unlimited CBT access, or come back tomorrow for 10 more free questions.</p>
        <a href="../premium.html" style="display:inline-block; background:#ffb703; color:#111; font-weight:700; padding:12px 24px; border-radius:8px; text-decoration:none;">Upgrade Now</a>
      </div>
    `;
  }
}
