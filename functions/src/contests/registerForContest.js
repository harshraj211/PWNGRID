/**
 * registerForContest.js
 * HTTPS Callable — registers a Pro user for an upcoming contest.
 *
 * Guards:
 *  - Must be authenticated + verified
 *  - Must have plan === "pro"
 *  - Contest must exist, be active, and not yet started
 *  - Registration must be open (before registrationDeadline)
 *  - User must not already be registered
 *  - Contest must not be full (maxParticipants)
 *
 * Writes:
 *  - contests/{contestId}/participants/{userId}
 *  - contests/{contestId}.participantCount++  (atomic)
 *
 * File location: functions/src/contests/registerForContest.js
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

exports.registerForContest = onCall({ enforceAppCheck: false }, async (request) => {
  // ── Auth ────────────────────────────────────────────────────────────────
  const { auth } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (!auth.token.email_verified) throw new HttpsError("failed-precondition", "Email not verified.");

  const userId = auth.uid;
  const { contestId, accessCode } = request.data;

  if (!contestId || typeof contestId !== "string") {
    throw new HttpsError("invalid-argument", "contestId is required.");
  }

  // ── Fetch user profile ───────────────────────────────────────────────────
  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User profile not found.");
  const user = userSnap.data();

  if (user.isBanned) {
    throw new HttpsError("permission-denied", "Account is banned.");
  }

  // ── Fetch contest ────────────────────────────────────────────────────────
  const contestRef  = db.collection("contests").doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) throw new HttpsError("not-found", "Contest not found.");
  const contest = contestSnap.data();

  if (!contest.isActive) {
    throw new HttpsError("failed-precondition", "Contest is not active.");
  }

  const now = Date.now();
  const startTime = contest.startTime?.toMillis?.() ?? 0;
  const regDeadline = contest.registrationDeadline?.toMillis?.() ?? startTime;

  if (now >= startTime) {
    throw new HttpsError("failed-precondition", "Contest has already started.");
  }
  if (now > regDeadline) {
    throw new HttpsError("failed-precondition", "Registration deadline has passed.");
  }

  // ── Check access code for private contests ──────────────────────────────
  if (contest.contestType === "private") {
    if (!accessCode || accessCode.trim() !== contest.accessCode) {
      throw new HttpsError("permission-denied", "Invalid access code.");
    }
  }

  // ── Check capacity ───────────────────────────────────────────────────────
  if (
    contest.maxParticipants &&
    (contest.participantCount || 0) >= contest.maxParticipants
  ) {
    throw new HttpsError("resource-exhausted", "Contest is full.");
  }

  // ── Check duplicate registration ─────────────────────────────────────────
  const participantRef  = contestRef.collection("participants").doc(userId);
  const participantSnap = await participantRef.get();
  if (participantSnap.exists) {
    throw new HttpsError("already-exists", "Already registered for this contest.");
  }

  // ── Register — atomic batch ───────────────────────────────────────────────
  const batch = db.batch();

  batch.set(participantRef, {
    userId,
    username:      user.username || "",
    registeredAt:  FieldValue.serverTimestamp(),
    score:         0,
    solveCount:    0,
    penalties:     0,            // wrong-answer penalty seconds (CTF-style)
    finishTime:    null,         // set when all challenges solved or contest ends
    rank:          null,         // computed by finalizeContest
    eloChange:     null,
  });

  batch.update(contestRef, {
    participantCount: FieldValue.increment(1),
  });

  await batch.commit();

  return {
    success: true,
    contestId,
    startTime: contest.startTime?.toMillis?.() ?? null,
    title: contest.title,
  };
});