// INDIGENE shared premium lock — ONE lock for every CBT and every Past Questions page.
//
// Who can open it:
//   1. Paystack (the payment Worker writes premiumUnlocks/{email})
//   2. You, from admin.html (writes the same premiumUnlocks/{email})
// Both write { email, premium: true, untilMs, days }. This file only READS it.
// (Old accounts with users/{uid}.plan = "premium" + premiumUntil still count, same as the home page.)
//
// MASTER SWITCH: config/settings.monetizationActive. While it is not true, everything stays open.
//
// ---- Use on a Past Questions page (pastquestions/chm101.html) ----
//
//   <div id="gate"></div>
//   <script type="module">
//     import { requirePremium } from "../premium.js";
//     const ok = await requirePremium(document.getElementById("gate"));
//     if (ok) { /* start the past questions here */ }
//   </script>
//
// ---- Use at the end of a free CBT run ----
//
//   import { openUpgradeOverlay } from "../premium.js";
//   openUpgradeOverlay();   // plans + Subscribe button; Close brings them back to the quiz

import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, onSnapshot, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Lets Firestore answer from its saved copy when the phone is offline (last known state).
try { enableIndexedDbPersistence(db).catch(() => {}); } catch (e) { /* ignore */ }

export const PLANS = [
  { id: "1w",  label: "1 week",   days: 7,   price: 500,  kobo: 50000 },
  { id: "2w",  label: "2 weeks",  days: 14,  price: 1000, kobo: 100000 },
  { id: "1m",  label: "Monthly",  days: 30,  price: 2000, kobo: 200000 },
  { id: "sem", label: "Semester", days: 120, price: 5000, kobo: 500000, badge: "Best value" },
];

const naira = (n) => "₦" + Number(n).toLocaleString("en-NG");

function withTimeout(promise, ms = 6000) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : Number(v) || 0);

// ---------- master switch ----------
// A page opens at once with the setting saved on the phone, while a live connection watches
// config/settings. If the real setting is different, the page refreshes itself and follows it.
const CACHE_KEY = "indigene_monetization_active";
const FIRST_WAIT = 2500; // only for a phone that has nothing saved yet

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw).value === true : null;
  } catch (e) { return null; }
}
// returns true only if the value really got saved (guards the refresh against looping)
function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ value, ts: Date.now() }));
    return readCache() === value;
  } catch (e) { return false; }
}

let used = null; // the answer this page is already running on
let first;
const firstAnswer = new Promise((resolve) => { first = resolve; });

try {
  onSnapshot(doc(db, "config", "settings"), { includeMetadataChanges: true }, (snap) => {
    if (snap.metadata.fromCache) return; // wait for the real server value
    const value = snap.exists() && snap.data().monetizationActive === true;
    const saved = writeCache(value);
    first(value);
    if (used !== null && used !== value) {
      used = value;
      if (saved) location.reload();
    }
  }, () => { /* no permission or no network: keep the saved setting */ });
} catch (e) { /* keep the saved setting */ }

// true when locks are being enforced. false = dormant, everything open.
export async function isMonetizationActive() {
  if (used !== null) return used;
  let value = readCache();
  if (value === null) {
    try { value = await withTimeout(firstAnswer, FIRST_WAIT); } catch (e) { value = false; }
  }
  used = value;
  return value;
}

// ---------- who is signed in ----------
export function waitForUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => { unsub(); resolve(user); });
  });
}

// ---------- the lock itself ----------
// Returns { loggedIn, premium, until, offline }
export async function getPremiumState() {
  const user = await waitForUser();
  if (!user) return { loggedIn: false, premium: false, until: 0, offline: false };
  const email = String(user.email || "").trim().toLowerCase();
  const reads = await Promise.allSettled([
    email ? withTimeout(getDoc(doc(db, "premiumUnlocks", email))) : Promise.resolve(null),
    withTimeout(getDoc(doc(db, "users", user.uid))),
  ]);
  const now = Date.now();
  let premium = false, until = 0;

  const pu = reads[0].status === "fulfilled" && reads[0].value && reads[0].value.exists() ? reads[0].value.data() : null;
  if (pu && pu.premium === true) {
    const u = Number(pu.untilMs) || 0;
    if (!u || u > now) { premium = true; until = u; }
  }
  const us = reads[1].status === "fulfilled" && reads[1].value && reads[1].value.exists() ? reads[1].value.data() : null;
  if (us && us.plan === "premium") {
    const u = toMs(us.premiumUntil);
    if (!u || u > now) { premium = true; until = Math.max(until, u); }
  }
  // Could not read and nothing proves premium: fail CLOSED (no saved copy on this phone yet)
  const offline = !premium && reads.some((r) => r.status === "rejected");
  return { loggedIn: true, premium, until, offline };
}

// Returns { ok: true } or { ok: false, reason: "login" | "premium" | "offline" }
export async function checkPremiumAccess() {
  let active;
  try { active = await isMonetizationActive(); } catch (e) { active = false; }
  if (!active) return { ok: true };
  const s = await getPremiumState();
  if (!s.loggedIn) return { ok: false, reason: "login" };
  if (s.premium) return { ok: true, until: s.until };
  return { ok: false, reason: s.offline ? "offline" : "premium" };
}

// One call for a premium-only page. Draws the lock screen itself. Resolves true if the page may start.
export async function requirePremium(container) {
  const r = await checkPremiumAccess();
  if (r.ok) return true;
  if (container) renderPremiumLock(container, r.reason);
  return false;
}

// ---------- screens ----------
const BOX = "background:#161616;border-radius:12px;padding:30px 20px;text-align:center;color:#eee;font-family:-apple-system,sans-serif;";
const BTN = "display:inline-block;background:#ffb703;color:#111;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;";

function plansHtml() {
  return PLANS.map((p) =>
    `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 12px;margin:6px 0;border:1px solid #2c2c2c;border-radius:8px;font-size:14px;">` +
    `<span>${p.label}</span><b style="color:#ffb703;">${naira(p.price)}</b></div>`
  ).join("");
}

export function renderPremiumLock(container, reason) {
  if (reason === "login") {
    container.innerHTML = `<div style="${BOX}"><div style="font-size:40px;margin-bottom:10px;">🔑</div>
      <h3 style="color:#ffb703;margin:0 0 10px 0;">Please log in</h3>
      <p style="color:#aaa;margin:0 0 18px 0;">You need an INDIGENE account to open this.</p>
      <a href="/login.html" style="${BTN}">Log In</a></div>`;
  } else if (reason === "offline") {
    container.innerHTML = `<div style="${BOX}"><div style="font-size:40px;margin-bottom:10px;">📶</div>
      <h3 style="color:#ffb703;margin:0 0 10px 0;">Connect once to verify access</h3>
      <p style="color:#aaa;margin:0;">This phone has not checked in online yet. Connect to the internet once, then try again.</p></div>`;
  } else {
    container.innerHTML = `<div style="${BOX}"><div style="font-size:40px;margin-bottom:10px;">🔒</div>
      <h3 style="color:#ffb703;margin:0 0 10px 0;">Premium only</h3>
      <p style="color:#aaa;margin:0 0 14px 0;">Subscribe to open the past questions and every full CBT.</p>
      <div style="text-align:left;margin:0 0 18px 0;">${plansHtml()}</div>
      <a href="/premium.html" style="${BTN}">Subscribe</a></div>`;
  }
}

// In-page screen for the end of a free run. Close just removes it.
export function openUpgradeOverlay(message) {
  if (document.getElementById("indigene-upgrade")) return;
  const wrap = document.createElement("div");
  wrap.id = "indigene-upgrade";
  wrap.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px;";
  wrap.innerHTML = `<div style="${BOX}width:100%;max-width:380px;box-sizing:border-box;">
    <h3 style="color:#ffb703;margin:0 0 10px 0;">Want the rest?</h3>
    <p style="color:#aaa;margin:0 0 14px 0;">${message || "This was the free part. Subscribe to open every topic, the full CBT and the past questions."}</p>
    <div style="text-align:left;margin:0 0 18px 0;">${plansHtml()}</div>
    <a href="/premium.html" style="${BTN}width:100%;box-sizing:border-box;">Subscribe</a>
    <button id="indigene-upgrade-x" type="button" style="margin-top:12px;width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:transparent;color:#bbb;font-size:14px;cursor:pointer;">Close</button>
  </div>`;
  document.body.appendChild(wrap);
  document.getElementById("indigene-upgrade-x").onclick = () => wrap.remove();
}

export { auth, db };
