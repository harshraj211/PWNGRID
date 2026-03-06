/**
 * getAnalytics.js
 * Cloud Function — HTTPS Callable (Admin only)
 *
 * Returns platform analytics for the admin dashboard.
 * Runs aggregation queries on demand — not cached (add Redis on scale phase).
 *
 * Input:  {} (no params needed)
 *
 * Output: {
 *   users:       { total, activeToday, activeThisWeek, activeThisMonth, newThisWeek }
 *   challenges:  { total, mostSolved, hardest, avgSolveTimeByDifficulty }
 *   submissions: { totalToday, correctToday, accuracyToday }
 *   elo:         { distribution: { ranges, counts } }
 *   flags:       { totalUnresolved }
 * }
 *
 * File location: functions/src/admin/getAnalytics.js
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Timestamp } = require("firebase-admin/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

module.exports = functions.https.onCall(async (data, context) => {

  // ── 1. Admin auth check ───────────────────────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }
  // Check JWT custom claim first, fallback to Firestore role field
  let callerRole = context.auth.token.role;
  if (callerRole !== "admin") {
    const callerSnap = await db.collection("users").doc(context.auth.uid).get();
    if (callerSnap.exists) callerRole = callerSnap.data().role || "user";
  }
  if (callerRole !== "admin") {
    throw new functions.https.HttpsError("permission-denied", "Admin role required.");
  }

  // ── 2. Time boundaries ────────────────────────────────────────────────────
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart  = new Date(todayStart.getTime() - 7  * 24 * 60 * 60 * 1000);
  const monthStart = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

  const todayTs  = Timestamp.fromDate(todayStart);
  const weekTs   = Timestamp.fromDate(weekStart);
  const monthTs  = Timestamp.fromDate(monthStart);

  // ── 3. Run all queries in parallel ────────────────────────────────────────
  const [
    totalUsersSnap,
    activeTodaySnap,
    activeWeekSnap,
    activeMonthSnap,
    newThisWeekSnap,
    totalChallengesSnap,
    mostSolvedSnap,
    hardestSnap,
    easyAvgSnap,
    mediumAvgSnap,
    hardAvgSnap,
    submissionsTodaySnap,
    correctTodaySnap,
    unresolvedFlagsSnap,
    eloDistSnap,
  ] = await Promise.all([

    // Total users
    db.collection("users").count().get(),

    // Active today (lastLoginAt >= today)
    db.collection("users").where("lastLoginAt", ">=", todayTs).count().get(),

    // Active this week
    db.collection("users").where("lastLoginAt", ">=", weekTs).count().get(),

    // Active this month
    db.collection("users").where("lastLoginAt", ">=", monthTs).count().get(),

    // New users this week
    db.collection("users").where("createdAt", ">=", weekTs).count().get(),

    // Total active challenges
    db.collection("challenges").where("isActive", "==", true).count().get(),

    // Most solved challenge
    db.collection("challenges")
      .where("isActive", "==", true)
      .orderBy("solveCount", "desc")
      .limit(1)
      .get(),

    // Hardest challenge (lowest solve rate = lowest solveCount relative to attemptCount)
    // Proxy: lowest solveCount among hard challenges
    db.collection("challenges")
      .where("isActive", "==", true)
      .where("difficulty", "==", "hard")
      .orderBy("solveCount", "asc")
      .limit(1)
      .get(),

    // Avg solve time — easy challenges
    db.collection("challenges")
      .where("isActive", "==", true)
      .where("difficulty", "==", "easy")
      .select("avgSolveTime")
      .get(),

    // Avg solve time — medium challenges
    db.collection("challenges")
      .where("isActive", "==", true)
      .where("difficulty", "==", "medium")
      .select("avgSolveTime")
      .get(),

    // Avg solve time — hard challenges
    db.collection("challenges")
      .where("isActive", "==", true)
      .where("difficulty", "==", "hard")
      .select("avgSolveTime")
      .get(),

    // Total submissions today
    db.collection("submissions").where("timestamp", ">=", todayTs).count().get(),

    // Correct submissions today
    db.collection("submissions")
      .where("timestamp", ">=", todayTs)
      .where("isCorrect", "==", true)
      .count()
      .get(),

    // Unresolved flags
    db.collection("flags").where("resolvedAt", "==", null).count().get(),

    // ELO distribution sample (top 500 users)
    db.collection("users")
      .orderBy("elo", "desc")
      .limit(500)
      .select("elo")
      .get(),
  ]);

  // ── 4. Process results ────────────────────────────────────────────────────

  // Most solved challenge
  const mostSolved = mostSolvedSnap.empty ? null : {
    id: mostSolvedSnap.docs[0].id,
    title: mostSolvedSnap.docs[0].data().title,
    solveCount: mostSolvedSnap.docs[0].data().solveCount,
    difficulty: mostSolvedSnap.docs[0].data().difficulty,
  };

  // Hardest challenge
  const hardest = hardestSnap.empty ? null : {
    id: hardestSnap.docs[0].id,
    title: hardestSnap.docs[0].data().title,
    solveCount: hardestSnap.docs[0].data().solveCount,
    attemptCount: hardestSnap.docs[0].data().attemptCount,
    solveRate: hardestSnap.docs[0].data().attemptCount > 0
      ? ((hardestSnap.docs[0].data().solveCount / hardestSnap.docs[0].data().attemptCount) * 100).toFixed(1) + "%"
      : "0%",
  };

  // Average solve times by difficulty
  const calcAvg = (snap) => {
    const times = snap.docs
      .map((d) => d.data().avgSolveTime)
      .filter((t) => t && t > 0);
    if (times.length === 0) return null;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  };

  // Submissions accuracy today
  const submissionsToday = submissionsTodaySnap.data().count;
  const correctToday     = correctTodaySnap.data().count;
  const accuracyToday    = submissionsToday > 0
    ? ((correctToday / submissionsToday) * 100).toFixed(1) + "%"
    : "N/A";

  // ELO distribution histogram (buckets of 100)
  const eloValues = eloDistSnap.docs.map((d) => d.data().elo || 0);
  const eloDistribution = buildEloHistogram(eloValues);

  // Unresolved flags — handle null query gracefully
  let unresolvedFlags = 0;
  try {
    unresolvedFlags = unresolvedFlagsSnap.data().count;
  } catch {
    // Fallback if null equality query fails
    const fallback = await db.collection("flags")
      .where("resolvedAt", "==", null)
      .get();
    unresolvedFlags = fallback.size;
  }

  // ── 5. Return analytics payload ───────────────────────────────────────────
  return {
    users: {
      total:          totalUsersSnap.data().count,
      activeToday:    activeTodaySnap.data().count,
      activeThisWeek: activeWeekSnap.data().count,
      activeThisMonth: activeMonthSnap.data().count,
      newThisWeek:    newThisWeekSnap.data().count,
    },
    challenges: {
      total:      totalChallengesSnap.data().count,
      mostSolved,
      hardest,
      avgSolveTime: {
        easy:   calcAvg(easyAvgSnap),
        medium: calcAvg(mediumAvgSnap),
        hard:   calcAvg(hardAvgSnap),
      },
    },
    submissions: {
      totalToday:    submissionsToday,
      correctToday,
      accuracyToday,
    },
    elo: {
      distribution: eloDistribution,
    },
    flags: {
      totalUnresolved: unresolvedFlags,
    },
    generatedAt: new Date().toISOString(),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds an ELO histogram with buckets of 100.
 * e.g. 0-99, 100-199, 200-299, ...
 *
 * @param {number[]} eloValues
 * @returns {{ labels: string[], counts: number[] }}
 */
function buildEloHistogram(eloValues) {
  if (eloValues.length === 0) {
    return { labels: [], counts: [] };
  }

  const maxElo = Math.max(...eloValues);
  const bucketSize = 100;
  const numBuckets = Math.ceil((maxElo + 1) / bucketSize);

  const counts = new Array(numBuckets).fill(0);
  const labels = [];

  for (let i = 0; i < numBuckets; i++) {
    labels.push(`${i * bucketSize}–${(i + 1) * bucketSize - 1}`);
  }

  eloValues.forEach((elo) => {
    const bucket = Math.floor(elo / bucketSize);
    if (bucket < numBuckets) counts[bucket]++;
  });

  return { labels, counts };
}