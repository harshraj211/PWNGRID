/**
 * resetWeeklyElo.js
 * Cloud Function — Scheduled (Cron)
 * Schedule: every Monday at 00:00 UTC
 * Firebase schedule syntax: "every monday 00:00"
 *
 * What it does:
 *  1. Snapshots top 100 users into leaderboard/weekly_lastWeek (for "last week" display)
 *  2. Resets weeklyElo to 0 on ALL users in batches
 *  3. Updates publicProfiles with fresh weeklyElo
 *
 * File location: functions/src/leaderboard/resetWeeklyElo.js
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Firestore max batch size
const BATCH_SIZE = 400;

module.exports = functions.pubsub
  .schedule("every monday 00:00")
  .timeZone("UTC")
  .onRun(async (_context) => {
    console.log("resetWeeklyElo: starting weekly reset");
    const startTime = Date.now();

    try {
      // ── Step 1: Snapshot top 100 for "last week leaderboard" display ─────────
      const top100Snap = await db
        .collection("users")
        .orderBy("weeklyElo", "desc")
        .limit(100)
        .get();

      const snapshot = top100Snap.docs.map((doc, index) => ({
        rank: index + 1,
        userId: doc.id,
        username: doc.data().username,
        weeklyElo: doc.data().weeklyElo || 0,
        elo: doc.data().elo || 0,
      }));

      // Store snapshot with timestamp key so historical weeks are preserved
      const weekLabel = getPreviousWeekLabel();
      await db.collection("leaderboard").doc(`weekly_${weekLabel}`).set({
        type: "weekly",
        weekLabel,
        snapshot,
        generatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`resetWeeklyElo: snapshot saved as weekly_${weekLabel}`);

      // ── Step 2: Reset weeklyElo to 0 on all users (batched) ──────────────────
      let lastDoc = null;
      let totalReset = 0;
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
          batch.update(doc.ref, { weeklyElo: 0 });
          // Sync publicProfiles
          batch.update(db.collection("publicProfiles").doc(doc.id), { weeklyElo: 0 });
        });
        await batch.commit();

        totalReset += snap.docs.length;
        lastDoc = snap.docs[snap.docs.length - 1];
        hasMore = snap.docs.length === BATCH_SIZE;

        console.log(`resetWeeklyElo: reset ${totalReset} users so far...`);
      }

      // ── Step 3: Log the reset event ───────────────────────────────────────────
      await db.collection("adminLogs").add({
        type: "weekly_elo_reset",
        weekLabel,
        totalUsersReset: totalReset,
        durationMs: Date.now() - startTime,
        executedAt: FieldValue.serverTimestamp(),
      });

      console.log(`resetWeeklyElo: done. Reset ${totalReset} users in ${Date.now() - startTime}ms`);
      return null;

    } catch (err) {
      console.error("resetWeeklyElo: FAILED", err);
      throw err; // Re-throw so Firebase marks the run as failed
    }
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the ISO week label for the week that just ended.
 * Format: "2026-W08" (year + week number)
 * @returns {string}
 */
function getPreviousWeekLabel() {
  const now = new Date();
  // Go back 1 day to be safely in the previous week
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const year = lastWeek.getUTCFullYear();
  const weekNum = getISOWeekNumber(lastWeek);
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Calculates ISO 8601 week number for a given date.
 * @param {Date} date
 * @returns {number}
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}