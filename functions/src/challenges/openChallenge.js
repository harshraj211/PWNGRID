/**
 * openChallenge.js
 * Cloud Function — HTTPS Callable
 *
 * Called when a user opens a challenge page.
 * Records openTimestamp server-side so timeTaken can be calculated
 * accurately on submission (never trust client timestamps).
 *
 * Firestore write: activeSessions/{userId}_{challengeId}
 *
 * Input:  { challengeId: string }
 * Output: { success: true, sessionId: string, openTimestamp: number }
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

// ── Init guard (safe to call multiple times across functions) ─────────────────
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ── Constants ─────────────────────────────────────────────────────────────────
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

module.exports = functions.https.onCall(async (data, context) => {
  // ── 1. Auth check ────────────────────────────────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in to open a challenge."
    );
  }

  const userId = context.auth.uid;
  const { challengeId } = data;

  // ── 2. Input validation ───────────────────────────────────────────────────────
  if (!challengeId || typeof challengeId !== "string") {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "challengeId is required."
    );
  }

  // ── 3. Verify challenge exists and is active ──────────────────────────────────
  const challengeRef = db.collection("challenges").doc(challengeId);
  const challengeSnap = await challengeRef.get();

  if (!challengeSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Challenge not found.");
  }

  const challenge = challengeSnap.data();

  if (!challenge.isActive) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "This challenge is not currently active."
    );
  }

  // ── 4. Check if user has already solved this challenge ────────────────────────
  // (Optional: allow re-opening but flag it — useful for practice mode)
  const existingSubmission = await db
    .collection("submissions")
    .where("userId", "==", userId)
    .where("challengeId", "==", challengeId)
    .where("isCorrect", "==", true)
    .limit(1)
    .get();

  const alreadySolved = !existingSubmission.empty;

  // ── 5. Write activeSession — preserve existing openTimestamp ────────────────
  // Composite key: userId_challengeId
  const sessionId = `${userId}_${challengeId}`;
  const sessionRef = db.collection("activeSessions").doc(sessionId);
  const existingSession = await sessionRef.get();

  let openTimestamp;

  if (existingSession.exists) {
    const existingData = existingSession.data();
    const isExpired = Date.now() > (existingData.expiresAt || 0);

    if (!isExpired) {
      // Session still valid — keep original openTimestamp (prevents timer reset on re-render)
      openTimestamp = existingData.openTimestamp;
    } else {
      // Expired — create fresh session
      openTimestamp = Date.now();
    }
  } else {
    // No existing session — create new
    openTimestamp = Date.now();
  }

  const expiresAt = openTimestamp + SESSION_TTL_MS;

  await sessionRef.set({
    userId,
    challengeId,
    openTimestamp,
    expiresAt,
    hintUsed: existingSession.exists && !((Date.now()) > (existingSession.data().expiresAt || 0))
      ? (existingSession.data().hintUsed || false)
      : false,
    expiresAtTimestamp: Timestamp.fromMillis(expiresAt),
  });

  return {
    success: true,
    sessionId,
    openTimestamp,
    alreadySolved, // Let frontend show "You've solved this — practice mode" UI
    challengeMeta: {
      title: challenge.title,
      difficulty: challenge.difficulty,
      expectedTime: challenge.expectedTime,
      flagFormat: challenge.flagFormat || null, // Hint for users on expected flag format
      // Never return: answerHash, hint (unless separately requested), tags
    },
  };
});