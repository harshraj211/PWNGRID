/**
 * config.js
 * Firebase initialisation — single source of truth for all Firebase services.
 *
 * Rules:
 *  - No business logic here — just init and export
 *  - Emulators auto-connect when VITE_USE_EMULATOR=true
 *  - Region configurable via VITE_FIREBASE_REGION (default: us-central1)
 *  - Analytics only loads in production (skipped in emulator / CI)
 *
 * Required env vars (copy frontend/.env.example → frontend/.env):
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_STORAGE_BUCKET
 *   VITE_FIREBASE_MESSAGING_SENDER_ID
 *   VITE_FIREBASE_APP_ID
 *   VITE_FIREBASE_MEASUREMENT_ID   (optional — for Analytics)
 *   VITE_FIREBASE_REGION           (optional — default: us-central1)
 *   VITE_USE_EMULATOR              (optional — "true" for local dev)
 *   VITE_RAZORPAY_KEY_ID           (Razorpay publishable key)
 *
 * File location: frontend/src/firebase/config.js
 */

import { initializeApp }                          from "firebase/app";
import { getAuth, connectAuthEmulator }           from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAnalytics, isSupported }              from "firebase/analytics";
import { getStorage }                             from "firebase/storage";

// ── Firebase config from Vite env ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// ── Startup validation ────────────────────────────────────────────────────────
const REQUIRED = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
const missing  = REQUIRED.filter(k => !firebaseConfig[k]);
if (missing.length > 0) {
  // Readable env var names for the error message
  const toEnv = k => "VITE_FIREBASE_" + k.replace(/([A-Z])/g, "_$1").toUpperCase();
  console.error(
    `[firebase/config] Missing required env vars: ${missing.map(toEnv).join(", ")}\n` +
    "Copy frontend/.env.example → frontend/.env and fill in your Firebase values."
  );
}

// ── Initialise app ────────────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const auth = getAuth(app);

// ── Firestore ─────────────────────────────────────────────────────────────────
export const db = getFirestore(app);

// ── Cloud Functions ───────────────────────────────────────────────────────────
const region = import.meta.env.VITE_FIREBASE_REGION || "us-central1";
export const functions = getFunctions(app, region);
export const storage = getStorage(app);

// ── Emulator suite ────────────────────────────────────────────────────────────
// Set VITE_USE_EMULATOR=true in frontend/.env.local to activate ALL emulators.
// Run: firebase emulators:start --only auth,firestore,functions
if (import.meta.env.VITE_USE_EMULATOR === "true") {
  console.info("[firebase/config] 🔧 Emulator mode — connecting to local Firebase emulators");
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectFunctionsEmulator(functions, "localhost", 5001);
} else if (import.meta.env.VITE_USE_FUNCTION_EMULATOR === "true") {
  // Connect ONLY functions to emulator — keeps production Auth + Firestore.
  // Useful when Blaze plan isn't enabled (can't deploy functions).
  // Run: firebase emulators:start --only functions
  console.info("[firebase/config] 🔧 Functions emulator mode — functions on localhost:5001, production Auth + Firestore");
  connectFunctionsEmulator(functions, "localhost", 5001);
}

// ── Analytics ─────────────────────────────────────────────────────────────────
// Async load — never blocks app startup, silently skipped if unsupported
// (ad blockers, Firefox strict mode, emulator, CI all safely no-op).
export let analytics = null;
if (
  import.meta.env.PROD &&
  firebaseConfig.measurementId &&
  import.meta.env.VITE_USE_EMULATOR !== "true"
) {
  isSupported()
    .then(ok => { if (ok) analytics = getAnalytics(app); })
    .catch(() => {});
}

export default app;