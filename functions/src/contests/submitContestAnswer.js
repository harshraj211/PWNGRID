/**
 * submitContestAnswer.js
 * HTTPS Callable — submits an answer during an active contest.
 *
 * Key differences from submitAnswer (free practice):
 *  - Must be registered participant
 *  - Contest must be in progress (started, not ended)
 *  - Wrong answers add a TIME PENALTY (5 min per wrong answer, CTF-style)
 *  - Correct answers update participant score + solveCount atomically
 *  - No ELO change mid-contest — ELO is awarded by finalizeContest
 *  - No daily solve limit applies
 *  - Hints cost double (40% penalty on final ELO award vs 20% in practice)
 *  - Per-challenge attempt rate limit: 10s cooldown after wrong answer
 *
 * Scoring model:
 *  score = sum of challenge basePoints × time_factor for each correct solve
 *  time_factor = 1 - (timeSinceContestStart / contestDuration) × 0.5
 *  (solving earlier in the contest gives more points, min factor 0.5)
 *
 * File location: functions/src/contests/submitContestAnswer.js
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { normalizeAnswer } = require("../lib/normalizeAnswer");
const { hashAnswer }      = require("../lib/hashAnswer");
const { sendNotification } = require("../lib/sendNotification");

const db = getFirestore();

const WRONG_ANSWER_PENALTY_SECONDS = 5 * 60; // 5 min per wrong answer
const RATE_LIMIT_SECONDS = 10;               // cooldown per challenge after wrong

exports.submitContestAnswer = onCall({ enforceAppCheck: false }, async (request) => {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { auth } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (!auth.token.email_verified) throw new HttpsError("failed-precondition", "Email not verified.");

  const userId = auth.uid;
  const { contestId, challengeId, answer } = request.data;
  // SECURITY: hintUsed read from server-side activeSession below

  if (!contestId || !challengeId || !answer) {
    throw new HttpsError("invalid-argument", "contestId, challengeId, and answer are required.");
  }

  // ── Fetch contest ─────────────────────────────────────────────────────────
  const contestRef  = db.collection("contests").doc(contestId);
  const contestSnap = await contestRef.get();
  if (!contestSnap.exists) throw new HttpsError("not-found", "Contest not found.");
  const contest = contestSnap.data();

  const now          = Date.now();
  const startMs      = contest.startTime?.toMillis?.() ?? 0;
  const endMs        = contest.endTime?.toMillis?.() ?? 0;

  if (now < startMs) {
    throw new HttpsError("failed-precondition", "Contest has not started yet.");
  }
  if (now > endMs) {
    throw new HttpsError("failed-precondition", "Contest has ended.");
  }
  if (!contest.isActive) {
    throw new HttpsError("failed-precondition", "Contest is not active.");
  }

  // ── Check participant registration ────────────────────────────────────────
  const participantRef  = contestRef.collection("participants").doc(userId);
  const participantSnap = await participantRef.get();
  if (!participantSnap.exists) {
    throw new HttpsError("permission-denied", "Not registered for this contest.");
  }
  const participant = participantSnap.data();

  // ── Fetch challenge ───────────────────────────────────────────────────────
  const challengeSnap = await db.collection("challenges").doc(challengeId).get();
  if (!challengeSnap.exists) throw new HttpsError("not-found", "Challenge not found.");
  const challenge = challengeSnap.data();

  // ── Fetch activeSession for server-side hintUsed ─────────────────────────
  const sessionId   = `${userId}_${challengeId}`;
  const sessionSnap = await db.collection("activeSessions").doc(sessionId).get();
  // SECURITY: If no session exists, hintUsed defaults to false (can't claim hint penalty reduction)
  const hintUsed    = sessionSnap.exists ? (sessionSnap.data().hintUsed === true) : false;

  // Verify challenge is part of this contest
  if (!contest.challengeIds?.includes(challengeId)) {
    throw new HttpsError("invalid-argument", "Challenge is not part of this contest.");
  }

  // ── Check per-challenge attempt rate limit ────────────────────────────────
  const attemptRef  = contestRef
    .collection("participants").doc(userId)
    .collection("attempts").doc(challengeId);
  const attemptSnap = await attemptRef.get();
  const attemptData = attemptSnap.exists ? attemptSnap.data() : null;

  if (attemptData?.lastWrongAt) {
    const secsSinceWrong = (now - attemptData.lastWrongAt.toMillis()) / 1000;
    if (secsSinceWrong < RATE_LIMIT_SECONDS) {
      const waitSecs = Math.ceil(RATE_LIMIT_SECONDS - secsSinceWrong);
      throw new HttpsError(
        "resource-exhausted",
        `Wait ${waitSecs}s before retrying this challenge.`
      );
    }
  }

  // ── Check if already solved this challenge in this contest ───────────────
  if (attemptData?.solved) {
    throw new HttpsError("already-exists", "Already solved this challenge in this contest.");
  }

  // ── Abuse detection ────────────────────────────────────────────────────────
  // Three triggers:
  //  (1) >10 submissions in 60s across all challenges  → rapid_submissions
  //  (2) >8 wrong answers on a single challenge        → brute_force
  //  (3) Correct answer <5s after switching challenges → cross_challenge_speed
  // Each trigger writes to the global `flags` collection (visible in Admin → Flags)
  // and marks the user doc with isFlagged:true so resolveFlag can act on it.

  const RAPID_THRESHOLD   = 10;        // submissions per 60 s
  const BRUTE_THRESHOLD   = 8;         // wrong answers on one challenge
  const FAST_SOLVE_MS     = 5000;      // ms between solving consecutive challenges

  // Helper: raise a global flag + mark user doc
  async function raiseAbuseFlag(reason, details) {
    const userRef  = db.collection("users").doc(userId);
    const flagRef  = db.collection("flags").doc();
    const username = participant.username || userId.slice(0, 8);

    const batch = db.batch();

    // Write to global flags collection (AdminFlags reads this)
    batch.set(flagRef, {
      userId,
      reportedUserId:   userId,
      reportedByUserId: "system",
      type:             "contest_abuse",
      reason,
      details,
      contestId,
      contestTitle:     contest.title || contestId,
      username,
      resolved:         false,
      createdAt:        FieldValue.serverTimestamp(),
    });

    // Mark user as flagged so resolveFlag + submit checks can act on it
    batch.update(userRef, {
      isFlagged:    true,
      flagReason:   reason,
      flaggedAt:    FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // Notify admins
    try {
      const adminSnap = await db.collection("users")
        .where("role", "==", "admin").get();
      for (const adm of adminSnap.docs) {
        await sendNotification(adm.id, {
          type:  "flag_warning",
          title: `⚠ Contest abuse: ${reason}`,
          body:  `User ${username} flagged in "${contest.title || contestId}" — ${details}`,
          link:  "/admin/flags",
        });
      }
    } catch (_) { /* non-fatal */ }
  }

  // Block any user already flagged from continuing to submit
  const userSnap = await db.collection("users").doc(userId).get();
  if (userSnap.exists && userSnap.data().isFlagged) {
    throw new HttpsError(
      "permission-denied",
      "Your account has been flagged for suspicious activity. Please contact support."
    );
  }

  // Trigger (1): rapid submissions in last 60s
  const recentSubsSnap = await db.collection("contestSubmissions")
    .where("contestId", "==", contestId)
    .where("userId",    "==", userId)
    .where("timestamp", ">",  Timestamp.fromMillis(now - 60000))
    .get();

  if (recentSubsSnap.size >= RAPID_THRESHOLD) {
    await raiseAbuseFlag(
      "rapid_submissions",
      `${recentSubsSnap.size} submissions in the last 60 seconds`
    );
    throw new HttpsError(
      "resource-exhausted",
      "Too many submissions in a short time. Your account has been flagged."
    );
  }

  // Trigger (2): brute-force wrong answers on this challenge
  const currentWrongCount = (attemptData?.wrongCount || 0);
  if (currentWrongCount >= BRUTE_THRESHOLD) {
    await raiseAbuseFlag(
      "brute_force",
      `${currentWrongCount} wrong answers on challenge ${challengeId} in contest ${contestId}`
    );
    throw new HttpsError(
      "resource-exhausted",
      "Too many wrong attempts on this challenge. Your account has been flagged."
    );
  }

  // Trigger (3): cross-challenge speed (first attempt, solved another challenge very recently)
  if (!attemptData?.lastWrongAt) {
    const prevSolvesSnap = await contestRef
      .collection("participants").doc(userId)
      .collection("attempts")
      .where("solved", "==", true)
      .get();

    if (prevSolvesSnap.size > 0) {
      const solvedTimes = prevSolvesSnap.docs
        .map(d => d.data().solvedAt?.toMillis?.() ?? 0)
        .filter(t => t > 0);
      const lastSolveMs = Math.max(...solvedTimes);
      const msSinceLast = now - lastSolveMs;

      if (msSinceLast > 0 && msSinceLast < FAST_SOLVE_MS) {
        await raiseAbuseFlag(
          "cross_challenge_speed",
          `Solved previous challenge only ${msSinceLast}ms ago before first attempt on next challenge`
        );
        // Don't block — could be a coincidence; just log and let admin review
      }
    }
  }

  // ── Verify answer ─────────────────────────────────────────────────────────
  const normalizedAnswer = normalizeAnswer(answer);
  const hashedSubmission = hashAnswer(normalizedAnswer);
  const isCorrect        = hashedSubmission === challenge.answerHash;

  const timeSinceStartMs  = now - startMs;
  const contestDurationMs = endMs - startMs;

  // ── Wrong answer path ─────────────────────────────────────────────────────
  if (!isCorrect) {
    const batch = db.batch();

    // Update attempt record
    batch.set(attemptRef, {
      challengeId,
      solved:       false,
      wrongCount:   FieldValue.increment(1),
      lastWrongAt:  FieldValue.serverTimestamp(),
    }, { merge: true });

    // Add time penalty to participant
    batch.update(participantRef, {
      penalties: FieldValue.increment(WRONG_ANSWER_PENALTY_SECONDS),
    });

    // Log submission
    batch.set(db.collection("contestSubmissions").doc(), {
      contestId,
      challengeId,
      userId,
      answer:    normalizedAnswer,
      isCorrect: false,
      timestamp: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      correct:         false,
      penaltyAdded:    WRONG_ANSWER_PENALTY_SECONDS,
      totalPenalties:  (participant.penalties || 0) + WRONG_ANSWER_PENALTY_SECONDS,
    };
  }

  // ── Correct answer path ───────────────────────────────────────────────────

  // Time-based score factor (1.0 early → 0.5 at contest end)
  const timeFactor = Math.max(
    0.5,
    1 - (timeSinceStartMs / contestDurationMs) * 0.5
  );
  const hintMultiplier = hintUsed ? 0.6 : 1.0; // hint = 40% penalty
  const basePoints     = challenge.basePoints || 100;
  const pointsEarned   = Math.round(basePoints * timeFactor * hintMultiplier);

  const batch = db.batch();

  // Mark attempt as solved
  batch.set(attemptRef, {
    challengeId,
    solved:      true,
    solvedAt:    FieldValue.serverTimestamp(),
    wrongCount:  attemptData?.wrongCount || 0,
    pointsEarned,
    hintUsed:    !!hintUsed,
  }, { merge: true });

  // Update participant score + solveCount
  const newSolveCount = (participant.solveCount || 0) + 1;
  const allSolved     = newSolveCount >= (contest.challengeIds?.length || 0);

  batch.update(participantRef, {
    score:      FieldValue.increment(pointsEarned),
    solveCount: FieldValue.increment(1),
    ...(allSolved ? { finishTime: Timestamp.fromMillis(now) } : {}),
  });

  // Log submission
  batch.set(db.collection("contestSubmissions").doc(), {
    contestId,
    challengeId,
    userId,
    username:     participant.username || "",
    answer:       normalizedAnswer,
    isCorrect:    true,
    pointsEarned,
    hintUsed:     !!hintUsed,
    timeSinceStartMs,
    timestamp:    FieldValue.serverTimestamp(),
  });

  // Increment challenge solveCount globally
  batch.update(db.collection("challenges").doc(challengeId), {
    solveCount: FieldValue.increment(1),
  });

  await batch.commit();

  return {
    correct:          true,
    pointsEarned,
    timeFactor:       parseFloat(timeFactor.toFixed(3)),
    hintMultiplier,
    allSolved,
    newScore:         (participant.score || 0) + pointsEarned,
    solveCount:       newSolveCount,
    totalChallenges:  contest.challengeIds?.length || 0,
  };
});