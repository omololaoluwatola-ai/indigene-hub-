// INDIGENE Paystack backend (Cloudflare Worker "indigene-pay")
// Routes: POST /init  POST /verify  POST /webhook
// Secrets: PAYSTACK_SECRET_KEY, FIREBASE_SA_JSON
// Variables: FIREBASE_API_KEY, FIREBASE_PROJECT_ID, CALLBACK_URL

const PLANS = {
  "1w":  { name: "1 week",   kobo: 50000,  days: 7 },
  "2w":  { name: "2 weeks",  kobo: 100000, days: 14 },
  "1m":  { name: "1 month",  kobo: 150000, days: 30 },
  "sem": { name: "Semester", kobo: 500000, days: 120 },
};
const ORIGINS = ["https://indigene.com.ng", "https://indigene.edu-hubs.workers.dev"];
const DAY = 86400000;
const enc = new TextEncoder();

function cors(req) {
  const o = req.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req, obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

// ---------- Google (Firestore) access ----------
const b64u = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
let tokenCache = { tok: null, exp: 0 };

async function googleToken(env) {
  if (tokenCache.tok && tokenCache.exp > Date.now() + 60000) return tokenCache.tok;
  const sa = JSON.parse(env.FIREBASE_SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64u(enc.encode(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  })));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + head + "." + claim + "." + b64u(sig),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error("google token failed");
  tokenCache = { tok: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}

// ---------- Who is calling ----------
async function authUser(req, env) {
  const m = (req.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  const r = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + env.FIREBASE_API_KEY,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: m[1] }) });
  if (!r.ok) return null;
  const d = await r.json();
  const u = d.users && d.users[0];
  return u ? { uid: u.localId, email: u.email || "" } : null;
}

// ---------- Paystack ----------
async function paystack(env, path, opts = {}) {
  const r = await fetch("https://api.paystack.co" + path, {
    ...opts,
    headers: { Authorization: "Bearer " + env.PAYSTACK_SECRET_KEY, "Content-Type": "application/json" },
  });
  return r.json();
}

// Returns {ok, uid, plan} only when Paystack says the money really came in
async function checkPayment(env, reference) {
  const d = await paystack(env, "/transaction/verify/" + encodeURIComponent(reference));
  const t = d && d.data;
  if (!d.status || !t) return { ok: false, status: "unknown" };
  if (t.status !== "success") return { ok: false, status: t.status };
  const meta = t.metadata || {};
  const plan = PLANS[meta.plan];
  if (!plan || !meta.uid || !meta.email) return { ok: false, status: "bad_metadata" };
  if (t.currency !== "NGN" || t.amount !== plan.kobo) return { ok: false, status: "amount_mismatch" };
  return { ok: true, uid: meta.uid, email: String(meta.email).trim().toLowerCase(), plan: meta.plan };
}

// ---------- Unlock premium (once per payment reference) ----------
// Writes premiumUnlocks/{email}: the same record admin.html writes, which premium.js, pq-gate.js and index.html already read.
async function grant(env, uid, email, planId, ref) {
  const p = PLANS[planId];
  const tok = await googleToken(env);
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const docs = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const base = "https://firestore.googleapis.com/v1/" + docs;

  for (let i = 0; i < 3; i++) {
    const pr = await fetch(`${base}/payments/${encodeURIComponent(ref)}`, { headers: H });
    if (pr.ok) {
      const pd = await pr.json();
      return { already: true, until: Number(pd.fields.untilMs.integerValue) };
    }
    const ur = await fetch(`${base}/premiumUnlocks/${encodeURIComponent(email)}`, { headers: H });
    let cur = 0, updateTime = null;
    if (ur.ok) {
      const ud = await ur.json();
      updateTime = ud.updateTime;
      const f = ud.fields && ud.fields.untilMs;
      if (f) cur = Number(f.integerValue || f.doubleValue) || 0;
    }
    const until = Math.max(Date.now(), cur) + p.days * DAY;
    const nowIso = new Date().toISOString();
    const body = {
      writes: [
        {
          update: {
            name: `${docs}/payments/${ref}`,
            fields: {
              uid: { stringValue: uid },
              email: { stringValue: email },
              plan: { stringValue: planId },
              amountKobo: { integerValue: String(p.kobo) },
              untilMs: { integerValue: String(until) },
              at: { timestampValue: nowIso },
            },
          },
          currentDocument: { exists: false },
        },
        {
          update: {
            name: `${docs}/premiumUnlocks/${email}`,
            fields: {
              email: { stringValue: email },
              premium: { booleanValue: true },
              days: { integerValue: String(p.days) },
              untilMs: { integerValue: String(until) },
              updatedAt: { timestampValue: nowIso },
            },
          },
          updateMask: { fieldPaths: ["email", "premium", "days", "untilMs", "updatedAt"] },
          currentDocument: updateTime ? { updateTime } : { exists: false },
        },
      ],
    };
    const cr = await fetch(`${base}:commit`, { method: "POST", headers: H, body: JSON.stringify(body) });
    if (cr.ok) return { already: false, until };
    if (cr.status !== 409 && cr.status !== 400) throw new Error("commit failed " + cr.status);
  }
  throw new Error("commit kept conflicting");
}

// ---------- Webhook signature ----------
async function signatureOk(env, raw, sig) {
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(env.PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---------- Routes ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== "POST") return json(req, { ok: true, service: "indigene-pay" });

    try {
      if (url.pathname === "/init") {
        const user = await authUser(req, env);
        if (!user) return json(req, { error: "login_required" }, 401);
        if (!user.email) return json(req, { error: "email_required" }, 400);
        const { plan } = await req.json();
        const p = PLANS[plan];
        if (!p) return json(req, { error: "bad_plan" }, 400);
        const d = await paystack(env, "/transaction/initialize", {
          method: "POST",
          body: JSON.stringify({
            email: user.email,
            amount: p.kobo,
            currency: "NGN",
            callback_url: env.CALLBACK_URL,
            metadata: { uid: user.uid, email: user.email.trim().toLowerCase(), plan },
          }),
        });
        if (!d.status) return json(req, { error: "paystack_failed" }, 502);
        return json(req, { url: d.data.authorization_url, reference: d.data.reference });
      }

      if (url.pathname === "/verify") {
        const user = await authUser(req, env);
        if (!user) return json(req, { error: "login_required" }, 401);
        const { reference } = await req.json();
        if (!reference || typeof reference !== "string") return json(req, { error: "no_reference" }, 400);
        const c = await checkPayment(env, reference);
        if (!c.ok) return json(req, { ok: false, status: c.status });
        if (c.uid !== user.uid) return json(req, { error: "not_your_payment" }, 403);
        const g = await grant(env, c.uid, c.email, c.plan, reference);
        return json(req, { ok: true, plan: c.plan, premiumUntil: g.until });
      }

      if (url.pathname === "/webhook") {
        const raw = await req.text();
        if (!(await signatureOk(env, raw, req.headers.get("x-paystack-signature")))) {
          return new Response("bad signature", { status: 401 });
        }
        const ev = JSON.parse(raw);
        if (ev.event === "charge.success" && ev.data && ev.data.reference) {
          const c = await checkPayment(env, ev.data.reference);
          if (c.ok) await grant(env, c.uid, c.email, c.plan, ev.data.reference);
        }
        return new Response("ok", { status: 200 });
      }
    } catch (e) {
      return json(req, { error: "server_error" }, 500);
    }
    return json(req, { error: "not_found" }, 404);
  },
};
