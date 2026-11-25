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
import { auth, db, isMonetizationActive, getPremiumState, waitForUser, openUpgradeOverlay } from "./premium.js";

const DAILY_LIMIT = 10;     // only used by old-style pages (MTH 102, 200-level) that cannot show the free 10
const FREE_N = 10;          // free plan: this many fixed questions from Chapter 1

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

// ======================================================================
// FREE PLAN ON THE STANDARD CBT PAGES (bio101, chm101, ...).
// Nothing below runs while the master switch is off. When it is on and the
// student is logged in and not premium, this file reshapes the page itself:
//   - every run uses the same fixed 10 questions of Chapter 1
//   - other chapters and Full / Half / Quick are shown locked
//   - the upgrade screen opens after each finished free run
// So the CBT files never need editing.
// ======================================================================
let freeOn = false;
let lastShownRun = null;

function isStandardPage() {
  try {
    return typeof window.begin === 'function' && typeof window.renderSetup === 'function' &&
      typeof window.finish === 'function' && Array.isArray(ALL) && Array.isArray(DATA) &&
      !!document.getElementById('runs') && !!document.getElementById('chapList');
  } catch (e) { return false; }
}

// FNV-1a: the same stem always gives the same number, so every student, every day, sees the same 10.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function freeTen() {
  return ALL.filter((q) => q.ch === 0)
    .map((q) => ({ q, h: fnv(String(q.stem)) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, FREE_N)
    .map((x) => x.q);
}

function showUpgrade(msg) {
  try { openUpgradeOverlay(msg); } catch (e) { /* ignore */ }
}

function decorateSetup() {
  if (!freeOn) return;
  const lockMsg = 'Full CBTs and every other topic are Premium. Free gives you the same 10 questions from Chapter 1 each day.';
  // free plan = Chapter 1 only
  mode = 'session'; sel.clear(); sel.add(0); secSel = null;
  document.querySelectorAll('#chapList .secs').forEach((e) => e.remove());

  document.querySelectorAll('#runs .run').forEach((b) => {
    if (b.dataset.m === 'session') return;
    b.style.opacity = '.55';
    b.classList.remove('sel');
    if (!b.querySelector('.ilock')) b.insertAdjacentHTML('beforeend', '<span class="ilock" style="display:block;margin-top:4px;font-size:.62rem;font-weight:800;letter-spacing:.08em;color:#ffb703">PREMIUM</span>');
    b.onclick = () => showUpgrade(lockMsg);
  });
  const sess = document.querySelector('#runs .run[data-m="session"]');
  if (sess) { sess.classList.add('sel'); sess.onclick = null; }

  document.querySelectorAll('#chapList .chap').forEach((d) => {
    if (+d.dataset.i === 0) { d.onclick = null; return; }
    d.style.opacity = '.55';
    const ct = d.querySelector('.ct');
    if (ct) { ct.textContent = 'PREMIUM'; ct.style.color = '#ffb703'; ct.style.fontWeight = '800'; ct.style.fontSize = '.7rem'; }
    d.onclick = () => showUpgrade(lockMsg);
  });
  const chaps = document.getElementById('chaps');
  if (chaps) chaps.classList.add('show');

  const setup = document.getElementById('setup');
  if (setup && !document.getElementById('free-note')) {
    const n = document.createElement('div');
    n.id = 'free-note';
    n.style.cssText = 'margin:0 0 12px 0;padding:11px 13px;border:1px solid #3a2f12;background:#1c1810;border-radius:10px;font-size:.82rem;line-height:1.45;color:#ddd;';
    n.innerHTML = '<b style="color:#ffb703">Free plan.</b> The same ' + FREE_N + ' questions from Chapter 1, every day, as many tries as you like. <a href="../premium.html" style="color:#ffb703;font-weight:700">Go Premium</a> for every topic.';
    const h = setup.querySelector('h2');
    setup.insertBefore(n, h ? h.nextSibling : setup.firstChild);
  }
}

function installFree() {
  if (freeOn || !isStandardPage()) return false;
  freeOn = true;

  const origBegin = window.begin;
  window.begin = function (pool, retry) {
    let p = pool;
    if (!retry) p = freeTen();
    else { const ok = new Set(freeTen().map((q) => q.id)); p = pool.filter((q) => ok.has(q.id)); if (!p.length) p = freeTen(); }
    return origBegin.call(this, p, retry);
  };
  const origSetup = window.renderSetup;
  window.renderSetup = function () {
    mode = 'session'; sel.clear(); sel.add(0); secSel = null;
    const r = origSetup.apply(this, arguments);
    decorateSetup();
    return r;
  };
  const origFinish = window.finish;
  window.finish = function () {
    const r = origFinish.apply(this, arguments);
    if (lastShownRun !== run) {
      lastShownRun = run;
      showUpgrade('Nice work on the free ' + FREE_N + '. Premium opens every topic, the full CBT and the past questions.');
    }
    return r;
  };
  try { const s = document.getElementById('setup'); if (s && !s.classList.contains('hidden')) window.renderSetup(); } catch (e) { /* ignore */ }
  return true;
}

// Looks at the switch and the student once the page has loaded. Does nothing while the switch is off.
(async function autoStart() {
  try {
    if (!(await isMonetizationActive())) return;
    const user = await waitForUser();
    if (!user) return;
    const ps = await getPremiumState();
    if (ps.premium || ps.offline) return;
    installFree();
  } catch (e) { /* never break the page */ }
})();

/**
 * Call this before starting a CBT. Returns:
 * { blocked: false, questionsAllowedToday: Infinity }  -> switch off, or premium
 * { blocked: false, free: true }                        -> free plan on a standard page (fixed 10 of Chapter 1)
 * { blocked: false, questionsAllowedToday: <n> }        -> old-style page on the daily 10 limit
 * { blocked: true, reason: 'limit' | 'login' | 'offline' }
 * Never throws.
 */
export async function checkCbtAccess(cbtId) {
  let monetizationActive;
  try { monetizationActive = await isMonetizationActive(); } catch (e) { monetizationActive = false; }
  if (!monetizationActive) return { blocked: false, questionsAllowedToday: Infinity };

  const user = await waitForUser();
  if (!user) return { blocked: true, reason: 'login' };

  const ps = await getPremiumState();
  if (ps.premium) return { blocked: false, questionsAllowedToday: Infinity };
  if (ps.offline) return { blocked: true, reason: 'offline' };

  // Standard page: fixed 10 of Chapter 1, no counting needed.
  if (installFree() || freeOn) return { blocked: false, free: true, questionsAllowedToday: FREE_N };

  // Old-style page: daily 10 limit.
  try {
    const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
    const usageSnap = await withTimeout(getDoc(usageRef));
    const usedToday = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;
    if (usedToday >= DAILY_LIMIT) return { blocked: true, reason: 'limit' };
    legacyCount = true;
    return { blocked: false, questionsAllowedToday: DAILY_LIMIT, usedToday };
  } catch (e) {
    return { blocked: true, reason: 'offline' };
  }
}

let legacyCount = false;

/** Counts a question only on old-style pages on the daily limit. Everyone else: does nothing. */
export async function recordCbtQuestionUsed() {
  if (!legacyCount) return;
  const user = auth.currentUser;
  if (!user) return;
  try {
    const usageRef = doc(db, 'cbtUsage', `${user.uid}_${todayKey()}`);
    const usageSnap = await withTimeout(getDoc(usageRef));
    const current = usageSnap.exists() ? (usageSnap.data().count || 0) : 0;
    await withTimeout(setDoc(usageRef, { count: current + 1, date: todayKey(), uid: user.uid }));
  } catch (e) { /* never interrupt the quiz */ }
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
