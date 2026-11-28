// INDIGENE payment helper for premium.html (talks to the indigene-pay Worker)
// Put your Worker address below, no slash at the end.
export const PAY_API = "https://indigene-pay.YOUR-NAME.workers.dev";

// planId: "1w" | "2w" | "1m" | "sem"; idToken: await auth.currentUser.getIdToken()
export async function startCheckout(planId, idToken) {
  const r = await fetch(PAY_API + "/init", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ plan: planId }),
  });
  const d = await r.json();
  if (!r.ok || !d.url) throw new Error(d.error || "Could not start payment");
  location.href = d.url;
}

// Call on premium.html load. Returns null if the student did not just come back from Paystack.
export async function confirmReturn(idToken) {
  const q = new URLSearchParams(location.search);
  const ref = q.get("reference") || q.get("trxref");
  if (!ref) return null;
  const r = await fetch(PAY_API + "/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
    body: JSON.stringify({ reference: ref }),
  });
  const d = await r.json();
  history.replaceState({}, "", location.pathname);
  d.reference = ref;
  return d;
}
