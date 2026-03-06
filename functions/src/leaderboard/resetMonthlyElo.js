/**
 * resetMonthlyElo.js
 * Cloud Function — Scheduled (Cron)
 * Schedule: 1st of every month at 00:00 UTC
 * Firebase schedule syntax: "0 0 1 * *" (cron format)
 *
 * What it does:
 *  1. Snapshots top 100 users into leaderboard/monthly_lastMonth
 *  2. Resets monthlyElo to 0 on ALL users in batches
 *  3. Allocates streak freeze credits to Pro users (2 per month)
 *  4. Logs the reset event to adminLogs
 *
 * File location: functions/src/leaderboard/resetMonthlyElo.js
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 400;

module.exports = functions.pubsub
  .schedule("0 0 1 * *")
  .timeZone("UTC")
  .onRun(async (_context) => {
    console.log("resetMonthlyElo: starting monthly reset");
    const startTime = Date.now();

    try {
      // ── Step 1: Snapshot top 100 for "last month leaderboard" display ─────────
      const top100Snap = await db
        .collection("users")
        .orderBy("monthlyElo", "desc")
        .limit(100)
        .get();

      const snapshot = top100Snap.docs.map((doc, index) => ({
        rank: index + 1,
        userId: doc.id,
        username: doc.data().username,
        monthlyElo: doc.data().monthlyElo || 0,
        elo: doc.data().elo || 0,
      }));

      const monthLabel = getPreviousMonthLabel();
      await db.collection("leaderboard").doc(`monthly_${monthLabel}`).set({
        type: "monthly",
        monthLabel,
        snapshot,
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`resetMonthlyElo: snapshot saved as monthly_${monthLabel}`);

      // ── Step 2: Reset monthlyElo + allocate streak freezes for Pro users ──────
      let lastDoc = null;
      let totalReset = 0;
      let freezesAllocated = 0;
      let hasMore = true;

      while (hasMore) {
        let query = db.collection("users").orderBy("__name__").limit(BATCH_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snap = await query.get();

        if (snap.empty) {
          hasMore = false;
          break;
        }

        const batch = db.batch();

        snap.docs.forEach((doc) => {
          const userData = doc.data();
          const isPro = userData.plan === "pro";

          const update = {
            monthlyElo: 0,
          };

          // Allocate 2 streak freezes to Pro users on the 1st of each month
          // Cap at 2 — unused freezes don't stack
          if (isPro) {
            update.streakFreezes = 2;
            freezesAllocated++;
          }

          batch.update(doc.ref, update);
          // Sync publicProfiles
          batch.update(db.collection("publicProfiles").doc(doc.id), { monthlyElo: 0 });
        });

        await batch.commit();

        totalReset += snap.docs.length;
        lastDoc = snap.docs[snap.docs.length - 1];
        hasMore = snap.docs.length === BATCH_SIZE;

        console.log(`resetMonthlyElo: processed ${totalReset} users so far...`);
      }

      // ── Step 3: Log the reset ─────────────────────────────────────────────────
      await db.collection("adminLogs").add({
        type: "monthly_elo_reset",
        monthLabel,
        totalUsersReset: totalReset,
        proUsersAllocatedFreezes: freezesAllocated,
        durationMs: Date.now() - startTime,
        executedAt: FieldValue.serverTimestamp(),
      });

      console.log(
        `resetMonthlyElo: done. Reset ${totalReset} users, allocated freezes to ${freezesAllocated} Pro users in ${Date.now() - startTime}ms`
      );
      return null;

    } catch (err) {
      console.error("resetMonthlyElo: FAILED", err);
      throw err;
    }
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the month label for the month that just ended.
 * Format: "2026-01" (year-month)
 * @returns {string}
 */
function getPreviousMonthLabel() {
  const now = new Date();
  // We're on the 1st — go back 1 day to land in last month
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const year = lastMonth.getUTCFullYear();
  const month = String(lastMonth.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}