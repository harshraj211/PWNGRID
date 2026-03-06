/**
 * submitAnswer.js
 * Cloud Function — HTTPS Callable
 *
 * The most critical function in OSINT Arena.
 * Handles the full solve pipeline:
 *   1. Auth + input validation
 *   2. Fetch activeSession → calculate timeTaken (server-side)
 *   3. Anti-cheat checks (rate limit, speed anomaly)
 *   4. Answer normalization + hash verification
 *   5a. CORRECT: ELO gain, streak update, heatmap update, badge check, log submission
 *   5b. INCORRECT: ELO deduction, log attempt, enforce rate limit
 *   6. Return result (NEVER return correct answer or hash)
 *
 * Input:  { challengeId: string, answer: string, hintUsed: boolean, contestId?: string }
 * Output: { correct: boolean, eloChange: number, ... } (see return shapes below)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Timestamp, FieldValue } = require("firebase-admin/firestore");

// ── Lib imports (pure, portable) ──────────────────────────────────────────────
const { calculateEloGain, calculateWrongAttemptDeduction } = require("../lib/calculateElo");
const { calculateStreak } = require("../lib/calculateStreak");
const { verifyAnswer } = require("../lib/hashAnswer");
const { runAntiCheatChecks } = require("../lib/antiCheat");
const { incrementHeatmapDay, getCurrentYear } = require("../lib/heatmap");

// ── Init guard ────────────────────────────────────────────────────────────────
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

module.exports = functions.https.onCall(async (data, context) => {
  const nowMs = Date.now();

  // ── 1. Auth check ─────────────────────────────────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in to submit an answer."
    );
  }

  const userId = context.auth.uid;

  // ── 2. Input validation ───────────────────────────────────────────────────────
  const { challengeId, answer, contestId = null } = data;
  // SECURITY: hintUsed is NOT accepted from client — read from activeSession below

  if (!challengeId || typeof challengeId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "challengeId is required.");
  }
  if (!answer || typeof answer !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "answer is required.");
  }
  if (answer.length > 500) {
    throw new functions.https.HttpsError("invalid-argument", "Answer exceeds maximum length.");
  }

  // ── 3. Fetch challenge doc ────────────────────────────────────────────────────
  const challengeRef = db.collection("challenges").doc(challengeId);
  const challengeSnap = await challengeRef.get();

  if (!challengeSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Challenge not found.");
  }

  const challenge = challengeSnap.data();

  // SECURITY: Ensure answerHash never leaks to client in any error response
  // (It's only used internally for verifyAnswer — never returned)
  // eslint-disable-next-line no-unused-vars
  const { answerHash: _answerHash, ...challengePublic } = challenge;

  if (!challenge.isActive) {
    throw new functions.https.HttpsError("failed-precondition", "Challenge is not active.");
  }

  // ── 4. Fetch activeSession → server-side timeTaken ────────────────────────────
  const sessionId = `${userId}_${challengeId}`;
  const sessionSnap = await db.collection("activeSessions").doc(sessionId).get();

  if (!sessionSnap.exists) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "No active session found. Please open the challenge first."
    );
  }

  const session  = sessionSnap.data();
  const timeTaken = Math.floor((nowMs - session.openTimestamp) / 1000); // seconds
  // SECURITY: read hintUsed from server-side session, never from client payload
  const hintUsed  = session.hintUsed === true;

  // ── 5. Fetch user doc ─────────────────────────────────────────────────────────
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new functions.https.HttpsError("not-found", "User profile not found.");
  }

  const user = userSnap.data();
  const isPro = user.plan === "pro" || user.role === "admin";

  // ── 5b. Access control gate ───────────────────────────────────────────────────
  // Easy:   always free
  // Medium: always free
  // Hard:   free only if it's the weekly free challenge (config/weeklyFreeChallenge)
  if (!isPro) {
    const difficulty = challenge.difficulty;

    if (difficulty === "hard") {
      // Check weekly free hard challenge
      const weeklyFreeSnap = await db.collection("config").doc("weeklyFreeChallenge").get();
      const weeklyFreeId   = weeklyFreeSnap.exists ? weeklyFreeSnap.data().challengeId : null;

      if (challengeId !== weeklyFreeId) {
        throw new functions.https.HttpsError(
          "permission-denied",
          "Hard challenges require a Pro subscription. One hard challenge is free each week."
        );
      }
    }
  }
  const recentAttemptsSnap = await db
    .collection("submissions")
    .where("userId", "==", userId)
    .where("challengeId", "==", challengeId)
    .get();

  // Filter in-memory for the 30-min window (avoids needing a separate composite index)
  const windowMs = nowMs - 30 * 60 * 1000;
  const recentDocs = recentAttemptsSnap.docs.filter(d => {
    const ts = d.data().timestamp;
    return ts && ts.toMillis() >= windowMs;
  });

  const recentAttemptTimestamps = recentDocs.map(
    (d) => d.data().timestamp.toMillis()
  );

  // Count wrong attempts this session (for ELO penalty)
  const wrongAttemptsThisSession = recentDocs.filter(
    (d) => !d.data().isCorrect
  ).length;

  // ── 7. Anti-cheat checks ──────────────────────────────────────────────────────
  // SECURITY: Use ONLY rawRequest.ip — the TCP connection IP set by GCP infrastructure.
  // All HTTP headers (including fastly-client-ip, x-forwarded-for, x-appengine-user-ip)
  // are attacker-controlled and MUST NOT be used for security decisions.
  // rawRequest.ip is populated by the Firebase Functions runtime from the actual
  // TCP connection, making it impossible for clients to spoof.
  const ip = context.rawRequest?.ip || "unknown";

  const antiCheat = runAntiCheatChecks({
    timeTaken,
    difficulty: challenge.difficulty,
    recentAttemptTimestamps,
    nowMs,
    ip,
  });

  if (antiCheat.shouldBlock) {
    throw new functions.https.HttpsError("resource-exhausted", antiCheat.blockReason);
  }

  // Flag account if suspicious (don't block — process submission normally)
  if (antiCheat.shouldFlag) {
    await db.collection("flags").add({
      userId,
      reason: antiCheat.flagReason,
      submissionId: null, // Will update after submission is created
      challengeId,
      timeTaken,
      ip,
      createdAt: FieldValue.serverTimestamp(),
      reviewedBy: null,
      resolvedAt: null,
    });

    // Mark user as flagged
    await userRef.update({
      isFlagged: true,
      flagReason: antiCheat.flagReason,
    });
  }

  // ── 8. Verify answer ──────────────────────────────────────────────────────────
  // Support both field names: answerHash (new) and flagHash (legacy)
  const storedHash = challenge.answerHash || challenge.flagHash;
  if (!storedHash) {
    throw new functions.https.HttpsError(
      "internal",
      "Challenge answer hash is missing. Please contact an admin."
    );
  }
  const isCorrect = verifyAnswer(
    answer,
    storedHash,
    challenge.answerNormalizationRules || {}
  );

  // ── 9a. WRONG ANSWER ──────────────────────────────────────────────────────────
  if (!isCorrect) {
    const eloDeduction = calculateWrongAttemptDeduction(wrongAttemptsThisSession);
    const newElo = Math.max(0, (user.elo || 0) + eloDeduction); // ELO floor at 0

    // Batch write: log submission + update user ELO
    const batch = db.batch();

    const submissionRef = db.collection("submissions").doc();
    batch.set(submissionRef, {
      userId,
      challengeId,
      isCorrect: false,
      timeTaken,
      eloChange: eloDeduction,
      wrongAttemptsBefore: wrongAttemptsThisSession,
      hintUsed,
      ipAddress: ip,
      contestId,
      timestamp: FieldValue.serverTimestamp(),
      isSuspicious: antiCheat.shouldFlag,
    });

    batch.update(userRef, {
      elo: newElo,
      wrongSubmissions: FieldValue.increment(1),
    });

    // Sync publicProfiles for leaderboard
    batch.update(db.collection("publicProfiles").doc(userId), {
      elo: newElo,
    });

    // Update challenge attempt count
    batch.update(challengeRef, {
      attemptCount: FieldValue.increment(1),
    });

    await batch.commit();

    return {
      correct: false,
      eloChange: eloDeduction,
      newElo,
      attemptsInWindow: antiCheat.rateLimitInfo.attemptsInWindow + 1,
      maxAttemptsInWindow: 5,
      message: "Incorrect answer. Try again.",
    };
  }

  // ── 9b. CORRECT ANSWER — Atomic transaction (prevents TOCTOU race condition) ──
  //
  // SECURITY FIX: Using runTransaction() instead of batch.commit() ensures that
  // the alreadySolved check and the ELO increment are a single atomic operation.
  // Concurrent requests will retry and only one will grant ELO.

  const currentYear = getCurrentYear();
  const heatmapRef = db.collection("heatmap").doc(userId).collection("years").doc(currentYear);

  let alreadySolved = false;
  let finalEloGain = 0;
  let eloGainResult = { finalEloGain: 0, baseElo: 0, timeBonus: 1, hintPenalty: 1, attemptPenalty: 1 };
  let streakResult = {
    currentStreak: user.currentStreak || 0,
    maxStreak: user.maxStreak || 0,
    lastActiveDate: user.lastActiveDate || null,
    streakChanged: false,
  };

  await db.runTransaction(async (tx) => {
    // Read alreadySolved INSIDE transaction — atomic with the write
    const alreadySolvedSnap = await tx.get(
      db.collection("submissions")
        .where("userId", "==", userId)
        .where("challengeId", "==", challengeId)
        .where("isCorrect", "==", true)
        .limit(1)
    );
    alreadySolved = !alreadySolvedSnap.empty;

    // Only grant ELO on first solve
    if (!alreadySolved) {
      try {
        eloGainResult = calculateEloGain({
          difficulty: challenge.difficulty || "easy",
          expectedTime: challenge.expectedTime || 300,
          timeTaken: timeTaken || 1,
          hintUsed,
          wrongAttempts: wrongAttemptsThisSession,
        });
      } catch (eloErr) {
        console.error("calculateEloGain failed, using defaults:", eloErr.message);
        eloGainResult = { finalEloGain: 10, baseElo: 10, timeBonus: 1, hintPenalty: 1, attemptPenalty: 1 };
      }
      streakResult = calculateStreak({
        lastActiveDate: user.lastActiveDate || null,
        currentStreak: user.currentStreak || 0,
        maxStreak: user.maxStreak || 0,
      });
    }
    finalEloGain = alreadySolved ? 0 : (eloGainResult.finalEloGain || 0);

    // Heatmap
    const heatmapSnap = await tx.get(heatmapRef);
    const existingHeatmap = heatmapSnap.exists ? heatmapSnap.data() : {};
    const { updatedMap: updatedHeatmap } = incrementHeatmapDay(existingHeatmap);

    // Solve time average (guard against NaN)
    const currentAvg = challenge.avgSolveTime || 0;
    const currentSolveCount = challenge.solveCount || 0;
    const rawNewAvg = (currentAvg * currentSolveCount + timeTaken) / (currentSolveCount + 1);
    const newAvgSolveTime = alreadySolved
      ? currentAvg
      : (Number.isFinite(rawNewAvg) ? Math.round(rawNewAvg) : 0);

    // Write submission log
    const submissionRef = db.collection("submissions").doc();
    tx.set(submissionRef, {
      userId, challengeId,
      isCorrect: true, timeTaken,
      eloChange: finalEloGain,
      wrongAttemptsBefore: wrongAttemptsThisSession,
      hintUsed, ipAddress: ip, contestId,
      timestamp: FieldValue.serverTimestamp(),
      isSuspicious: antiCheat.shouldFlag,
      isPracticeRe_solve: alreadySolved,
    });

    // Update user — every value MUST be non-undefined or Firestore crashes
    const safeEloGain = finalEloGain || 0;
    const userUpdate = {
      elo: FieldValue.increment(safeEloGain),
      weeklyElo: FieldValue.increment(safeEloGain),
      monthlyElo: FieldValue.increment(safeEloGain),
      correctSubmissions: FieldValue.increment(1),
      lastActiveDate: streakResult.lastActiveDate || null,
      currentStreak: streakResult.currentStreak || 0,
      maxStreak: streakResult.maxStreak || 0,
    };
    if (!alreadySolved) {
      userUpdate.totalSolved = FieldValue.increment(1);
      if (challenge.difficulty) {
        userUpdate[`solvedByDifficulty.${challenge.difficulty}`] = FieldValue.increment(1);
      }
    }
    tx.update(userRef, userUpdate);

    // Sync publicProfiles for leaderboard
    const pubRef = db.collection("publicProfiles").doc(userId);
    const pubUpdate = {
      elo: FieldValue.increment(safeEloGain),
      weeklyElo: FieldValue.increment(safeEloGain),
      monthlyElo: FieldValue.increment(safeEloGain),
      currentStreak: streakResult.currentStreak || 0,
      maxStreak: streakResult.maxStreak || 0,
    };
    if (!alreadySolved) {
      pubUpdate.totalSolved = FieldValue.increment(1);
    }
    tx.update(pubRef, pubUpdate);

    // Update challenge stats
    if (!alreadySolved) {
      tx.update(challengeRef, {
        solveCount:  FieldValue.increment(1),
        attemptCount: FieldValue.increment(1),
        avgSolveTime: newAvgSolveTime,
      });
    }

    // Heatmap + delete session
    tx.set(heatmapRef, updatedHeatmap);
    tx.delete(db.collection("activeSessions").doc(sessionId));
  });

  // ── Contest submission logging (outside main batch — non-blocking) ─────────────
  if (contestId && !alreadySolved) {
    db.collection("contestSubmissions").add({
      contestId,
      userId,
      challengeId,
      isCorrect: true,
      timeTaken,
      timestamp: FieldValue.serverTimestamp(),
    }).catch((err) => console.error("Contest submission log failed:", err));
  }

  // ── Badge check (async, non-blocking — runs after response) ──────────────────
  // Trigger badge evaluation without awaiting — don't delay user response
  checkAndAwardBadges(userId, {
    challengeId,
    difficulty: challenge.difficulty,
    timeTaken,
    expectedTime: challenge.expectedTime,
    streak: streakResult.currentStreak,
    tags: challenge.tags || [],
  }).catch((err) => console.error("Badge check failed:", err));

  // ── Return result ─────────────────────────────────────────────────────────────
  return {
    correct: true,
    alreadySolved,
    eloChange: finalEloGain,
    newElo: (user.elo || 0) + finalEloGain,
    breakdown: {
      baseElo: eloGainResult.baseElo || 0,
      timeBonus: eloGainResult.timeBonus || 1,
      hintPenalty: eloGainResult.hintPenalty || 1,
      attemptPenalty: eloGainResult.attemptPenalty || 1,
    },
    streak: {
      current: streakResult.currentStreak,
      max: streakResult.maxStreak,
      changed: streakResult.streakChanged,
      action: streakResult.action,
    },
    timeTaken,
    message: alreadySolved
      ? "Already solved — practice mode. No ELO awarded."
      : "Correct! Well done.",
  };
});

// ── Badge evaluation (internal — not exported) ────────────────────────────────
/**
 * Checks and awards badges after a correct solve.
 * Runs async after response is sent — never blocks the solve flow.
 *
 * @param {string} userId
 * @param {Object} solveContext
 */
async function checkAndAwardBadges(userId, solveContext) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  const user = userSnap.data();
  const currentBadges = user.badges || [];

  const newBadges = [];

  // "Speed Demon" — solved with 2x time bonus (timeTaken <= expectedTime / 2)
  if (solveContext.timeTaken <= solveContext.expectedTime / 2) {
    const speedSolves = (user.speedDemonProgress || 0) + 1;
    await userRef.update({ speedDemonProgress: speedSolves });
    if (speedSolves >= 10 && !currentBadges.includes("speed_demon")) {
      newBadges.push("speed_demon");
    }
  }

  // "Streak Master" — 30-day streak
  if (solveContext.streak >= 30 && !currentBadges.includes("streak_master")) {
    newBadges.push("streak_master");
  }

  // "First Blood" — check if this user is the first to solve this challenge
  const firstBloodSnap = await db
    .collection("submissions")
    .where("challengeId", "==", solveContext.challengeId)
    .where("isCorrect", "==", true)
    .get();

  if (!firstBloodSnap.empty) {
    // Find the earliest correct submission in-memory
    let earliestDoc = firstBloodSnap.docs[0];
    for (const d of firstBloodSnap.docs) {
      if (d.data().timestamp && earliestDoc.data().timestamp &&
          d.data().timestamp.toMillis() < earliestDoc.data().timestamp.toMillis()) {
        earliestDoc = d;
      }
    }
    const firstSolver = earliestDoc.data().userId;
    if (firstSolver === userId && !currentBadges.includes("first_blood")) {
      newBadges.push("first_blood");
    }
  }

  // Award new badges if any
  if (newBadges.length > 0) {
    await userRef.update({
      badges: FieldValue.arrayUnion(...newBadges),
    });
  }
}