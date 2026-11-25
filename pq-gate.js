// INDIGENE Past Questions gate
// One shared file for EVERY page in /pastquestions. Each page already asks this file
// "may this student in?" when it opens, so the lock is switched on here, once,
// and no past-question page ever needs to be uploaded again.
//
// While monetization is OFF (config/settings.monetizationActive is not true)
// everybody gets in, exactly like cbt-lock.js. The day you switch monetization
// on in your settings, Past Questions become premium only, with no re-upload.
//
// Premium means the same as on index.html:
//   users/{uid}.plan === "premium" and premiumUntil still in the future (or no end date)
//   OR premiumUnlocks/{email} with premium: true and untilMs still in the future (or no end date)
//
// Page use (already in every past-question page):
//   const r = await pqAccess("BIO101");
//   if (r.blocked) { show pqLockHTML(r.reason) } else { start }

import { auth, db } from "./auth.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Lets a paid student open Past Questions offline, from the last saved answer on this phone.
try { enableIndexedDbPersistence(db).catch(() => {}); } catch (e) { /* ignore */ }

const CACHE_KEY = "indigene_monetization_active"; // same cache cbt-lock.js uses
const CACHE_MS = 5 * 60 * 1000;

function within(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { value, ts } = JSON.parse(raw);
    return Date.now() - ts > CACHE_MS ? null : value;
  } catch (e) { return null; }
}
function writeCache(value) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ value, ts: Date.now() })); } catch (e) {}
}

async function monetizationOn() {
  const cached = readCache();
  if (cached === false) {
    // quick path for a switched-off site, refresh the answer for next time
    getDoc(doc(db, "config", "settings")).then(s => writeCache(s.exists() && s.data().monetizationActive === true)).catch(() => {});
    return false;
  }
  if (cached === true) return true;
  try {
    const s = await within(getDoc(doc(db, "config", "settings")), 6000);
    const v = s.exists() && s.data().monetizationActive === true;
    writeCache(v);
    return v;
  } catch (e) {
    return false; // cannot reach settings and nothing cached: nothing is being enforced yet
  }
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v === "number") return v;
  const d = new Date(v).getTime();
  return isNaN(d) ? 0 : d;
}

function waitForUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
}

export async function pqAccess(courseCode) {
  try {
    if (!(await monetizationOn())) return { blocked: false };

    const user = await waitForUser();
    if (!user) return { blocked: true, reason: "login" };

    const email = String(user.email || "").trim().toLowerCase();
    const [u, p] = await Promise.all([
      within(getDoc(doc(db, "users", user.uid)), 6000).catch(() => null),
      email ? within(getDoc(doc(db, "premiumUnlocks", email)), 6000).catch(() => null) : null
    ]);
    if (!u && !p) return { blocked: true, reason: "offline" };

    const ud = u && u.exists() ? u.data() : {};
    const until = toMs(ud.premiumUntil);
    const planPremium = ud.plan === "premium" && (!until || until > Date.now());

    const pd = p && p.exists() ? p.data() : null;
    const pUntil = pd ? Number(pd.untilMs) || 0 : 0;
    const manual = !!(pd && pd.premium === true && (!pUntil || pUntil > Date.now()));

    return (planPremium || manual) ? { blocked: false } : { blocked: true, reason: "premium" };
  } catch (e) {
    return { blocked: true, reason: "offline" };
  }
}

export function pqLockHTML(reason) {
  const btn = (href, label) =>
    `<a href="${href}" style="display:inline-block;margin-top:16px;background:linear-gradient(135deg,#ff6a1a,#e8350f);color:#fff;font-weight:800;padding:14px 26px;border-radius:14px;text-decoration:none;letter-spacing:.02em">${label}</a>`;
  const box = (title, text, action) =>
    `<div style="max-width:380px;margin:0 auto;background:#130a05;border:1.5px solid #6b3a1a;border-radius:20px;padding:26px 20px">
       <div style="font-family:Orbitron,sans-serif;font-weight:800;font-size:20px;color:#ffc24a;margin-bottom:8px">${title}</div>
       <div style="color:#bf9d86;line-height:1.5">${text}</div>${action}</div>`;
  if (reason === "login") return box("Log in first", "Past Questions are for INDIGENE students with an account.", btn("../login.html", "Log in"));
  if (reason === "offline") return box("Connect once", "We could not check your plan. Check your network and refresh.", btn("", "Refresh"));
  return box("Past Questions are premium", "Get a plan to practise every past question with timer, grades and full corrections.", btn("../premium.html", "See plans"));
}
