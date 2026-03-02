/**
 * setCustomClaims.js
 * HTTPS Callable — force-refreshes the caller's Firebase Auth custom claims
 * by reading their current plan from Firestore.
 *
 * When to call this from the frontend:
 *   1. After a successful Razorpay payment (the webhook already sets claims,
 *      but the client token needs a manual refresh to see the new claim).
 *   2. On app start if the user just upgraded and their token is stale.
 *
 * What it does:
 *   1. Reads users/{uid}.plan from Firestore (source of truth)
 *   2. Calls auth.setCustomUserClaims(uid, { plan, proExpiresAt })
 *   3. Returns { plan, proExpiresAt } so the frontend can update local state
 *
 * After calling this function, the frontend must force-refresh the ID token:
 *   await firebase.auth().currentUser.getIdToken(true)
 *   — AuthContext does this automatically via onIdTokenChanged listener.
 *
 * File location: functions/src/auth/setCustomClaims.js
 */

"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore }       = require("firebase-admin/firestore");
const { getAuth }            = require("firebase-admin/auth");

const db   = getFirestore();
const auth = getAuth();

exports.setCustomClaims = onCall({ enforceAppCheck: false }, async (request) => {
  // ── Auth guard ────────────────────────────────────────────────────────
  const { auth: authContext } = request;
  if (!authContext) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const uid = authContext.uid;

  // ── Read current plan from Firestore ──────────────────────────────────
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "User profile not found.");
  }

  const userData = userSnap.data();
  const plan     = userData.plan || "free";
  const proExpiresAt = userData.proExpiresAt?.toDate?.()?.toISOString() || null;

  // ── Check if Pro has expired ──────────────────────────────────────────
  let effectivePlan = plan;
  if (plan === "pro" && proExpiresAt && new Date(proExpiresAt) < new Date()) {
    // Pro has expired — downgrade
    effectivePlan = "free";
    await db.collection("users").doc(uid).update({
      plan:          "free",
      proExpiredAt:  new Date(),
    });
    await db.collection("publicProfiles").doc(uid).update({ plan: "free" });
    console.log(`setCustomClaims: Pro expired for uid=${uid} — downgraded to free`);
  }

  // ── Set custom claims ─────────────────────────────────────────────────
  // SECURITY: Role is NOT read from Firestore userData here.
  // An attacker could write role:"admin" to their Firestore doc and call this function.
  // Instead: preserve the role already in the existing JWT token (set only by
  // Admin SDK in privileged functions like adminSetRole), OR default to "user".
  // This means role escalation requires a privileged Admin SDK call — never a
  // client-writable Firestore field.
  const existingClaims = (await auth.getUser(uid)).customClaims || {};
  const safeRole = existingClaims.role || "user";  // trust existing JWT, not Firestore

  const claims = {
    plan: effectivePlan,
    role: safeRole,
    ...(effectivePlan === "pro" && proExpiresAt ? { proExpiresAt } : {}),
  };

  await auth.setCustomUserClaims(uid, claims);

  console.log(`setCustomClaims: updated claims for uid=${uid}`, claims);

  // ── Return so frontend can update local state without a full reload ───
  return {
    plan:          effectivePlan,
    proExpiresAt:  effectivePlan === "pro" ? proExpiresAt : null,
    role:          safeRole,
    claimsUpdated: true,
  };
});