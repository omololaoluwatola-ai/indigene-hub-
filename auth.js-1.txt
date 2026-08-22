// ============================================================
// INDIGENE Study Console — Auth Module
// ============================================================
// 1. Go to https://console.firebase.google.com
// 2. Create a project (any name, e.g. "indigene-hub")
// 3. Build > Authentication > Get Started > enable "Email/Password" AND "Google"
// 4. Build > Firestore Database > Create database > Start in TEST mode (for now)
// 5. Project settings (gear icon) > scroll to "Your apps" > click </> (web app)
//    Register app, copy the firebaseConfig object, paste it below.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---- PASTE YOUR FIREBASE CONFIG HERE ----
const firebaseConfig = {
  apiKey: "AIzaSyA7PzG9dzoGdp_eoNWGpQI1d_evqHOMls",
  authDomain: "indigene-hub.firebaseapp.com",
  projectId: "indigene-hub",
  storageBucket: "indigene-hub.firebasestorage.app",
  messagingSenderId: "839726253668",
  appId: "1:839726253668:web:b2ec508edb5c73f14a8171",
};
// ------------------------------------------

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Creates the Firestore user profile doc the first time someone signs in
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.displayName || "",
      email: user.email,
      plan: "free", // switch to "premium" later once payments are wired up
      createdAt: serverTimestamp(),
      progress: {}, // e.g. { ana203: { score: 82, lastAttempt: "..." } }
    });
  }
}

export async function registerWithEmail(name, email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });
  await ensureUserDoc(cred.user);
  return cred.user;
}

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await ensureUserDoc(cred.user);
  return cred.user;
}

export function logout() {
  return signOut(auth);
}

// Call this on any page to react to login state, e.g. showing "Hi, Tola" in the header
export function watchAuthState(callback) {
  onAuthStateChanged(auth, callback);
}

// Save a CBT score/progress entry for the logged-in user
export async function saveProgress(courseId, data) {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data().progress || {} : {};
  existing[courseId] = { ...data, updatedAt: new Date().toISOString() };
  await setDoc(ref, { progress: existing }, { merge: true });
}

function friendlyError(code) {
  const map = {
    "auth/email-already-in-use": "That email is already registered — try logging in instead.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/popup-closed-by-user": "Google sign-in was closed before finishing.",
  };
  return map[code] || `Something went wrong (${code || "unknown error"}). Screenshot this for support.`;
}

export { auth, db, friendlyError };
