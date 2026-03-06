/**
 * finalizeContest.js
 * Scheduled function — runs every 5 minutes.
 * Finds contests that have ended but not yet been finalized,
 * computes final rankings, awards ELO, and marks the contest closed.
 *
 * Ranking algorithm (CTF-style):
 *  1. Primary sort: score DESC
 *  2. Tiebreak: (finishTime + penalties) ASC  — faster + fewer wrong answers wins
 *  3. Participants who solved 0 challenges are ranked last
 *
 * ELO award:
 *  - 1st place:  +150 base ELO × difficulty multiplier
 *  - 2nd place:  +100
 *  - 3rd place:  +75
 *  - Top 10%:    +50
 *  - Top 25%:    +30
 *  - Top 50%:    +15
 *  - Participated (>0 solves): +5
 *  - No solves:  0
 *
 * Difficulty multipliers: easy ×1.0, medium ×1.5, hard ×2.0, mixed ×1.25
 *
 * Also triggers: adminLogs entry, reminder cleanup, contest status update.
 *
 * File location: functions/src/contests/finalizeContest.js
 */

const { onSchedule }      = require("firebase-functions/v2/scheduler");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { sendNotification } = require("../lib/sendNotification");

const db = getFirestore();


const DIFFICULTY_MULT = {
  easy:   1.0,
  medium: 1.5,
  hard:   2.0,
  mixed:  1.25,
};

exports.finalizeContest = onSchedule("every 5 minutes", async () => {
  const now = Timestamp.now();

  // ── Find contests to finalize ─────────────────────────────────────────────
  const contestsSnap = await db
    .collection("contests")
    .where("isActive",   "==", true)
    .where("finalized",  "==", false)
    .where("endTime",    "<=", now)
    .limit(5) // process max 5 per run to avoid timeout
    .get();

  if (contestsSnap.empty) return;

  for (const contestDoc of contestsSnap.docs) {
    try {
      await finalizeOne(contestDoc);
    } catch (err) {
      console.error(`finalizeContest: failed for ${contestDoc.id}`, err);
      // Continue to next contest — don't let one failure block others
    }
  }
});

// ── Finalize a single contest ─────────────────────────────────────────────────
async function finalizeOne(contestDoc) {
  const contestId = contestDoc.id;
  const contest   = contestDoc.data();

  console.log(`Finalizing contest: ${contestId} (${contest.title})`);

  const diffMult = DIFFICULTY_MULT[contest.difficulty] || DIFFICULTY_MULT.mixed;

  // ── Fetch all participants ────────────────────────────────────────────────
  const participantsSnap = await db
    .collection("contests").doc(contestId)
    .collection("participants")
    .get();

  if (participantsSnap.empty) {
    // No participants — just mark as finalized
    await contestDoc.ref.update({ isActive: false, finalized: true, finalizedAt: Timestamp.now() });
    return;
  }

  const participants = participantsSnap.docs.map(d => ({
    id:   d.id,
    ref:  d.ref,
    ...d.data(),
  }));

  // ── Auto-submit: set finishTime for anyone who didn't finish ──────────────
  const autoSubmitBatch = db.batch();
  let autoSubmitCount = 0;
  for (const p of participants) {
    if (!p.finishTime && (p.solveCount || 0) > 0) {
      autoSubmitBatch.update(p.ref, {
        finishTime: contest.endTime,
        autoSubmitted: true,
      });
      p.finishTime = contest.endTime;
      p.autoSubmitted = true;
      autoSubmitCount++;
    }
  }
  if (autoSubmitCount > 0) {
    await autoSubmitBatch.commit();
    console.log(`Auto-submitted finish times for ${autoSubmitCount} participants.`);
  }

  // ── Sort participants (CTF ranking) ───────────────────────────────────────
  const endMs = contest.endTime?.toMillis?.() ?? Date.now();

  const ranked = participants.sort((a, b) => {
    // No solves → rank last
    if ((a.solveCount || 0) === 0 && (b.solveCount || 0) > 0) return 1;
    if ((b.solveCount || 0) === 0 && (a.solveCount || 0) > 0) return -1;
    if ((a.solveCount || 0) === 0 && (b.solveCount || 0) === 0) return 0;

    // Primary: higher score is better
    if (b.score !== a.score) return (b.score || 0) - (a.score || 0);

    // Tiebreak: adjusted finish time (finishTime + penalties)
    const aFinish = (a.finishTime?.toMillis?.() ?? endMs) + (a.penalties || 0) * 1000;
    const bFinish = (b.finishTime?.toMillis?.() ?? endMs) + (b.penalties || 0) * 1000;
    return aFinish - bFinish;
  });

  const totalParticipants = ranked.length;

  // ── Compute ELO awards + write results ───────────────────────────────────
  const batch = db.batch();
  const eloLog = [];

  for (let i = 0; i < ranked.length; i++) {
    const p    = ranked[i];
    const rank = i + 1;

    // Determine ELO award
    let eloAward = 0;
    if ((p.solveCount || 0) > 0) {
      eloAward = getEloAward(rank, totalParticipants, diffMult);
    }

    // Update participant record
    batch.update(p.ref, {
      rank,
      eloChange:  eloAward,
      finalScore: p.score || 0,
      finalized:  true,
    });

    // Update user's global ELO
    if (eloAward > 0) {
      const userRef = db.collection("users").doc(p.id);
      batch.update(userRef, {
        elo:        FieldValue.increment(eloAward),
        weeklyElo:  FieldValue.increment(eloAward),
        monthlyElo: FieldValue.increment(eloAward),
      });

      // Sync publicProfiles for leaderboard
      batch.update(db.collection("publicProfiles").doc(p.id), {
        elo:        FieldValue.increment(eloAward),
        weeklyElo:  FieldValue.increment(eloAward),
        monthlyElo: FieldValue.increment(eloAward),
      });
    }

    eloLog.push({ userId: p.id, username: p.username, rank, score: p.score, eloAward });
  }

  // ── Mark contest finalized ────────────────────────────────────────────────
  batch.update(contestDoc.ref, {
    isActive:       false,
    finalized:      true,
    finalizedAt:    Timestamp.now(),
    finalRankings:  eloLog.slice(0, 10), // top 10 for display
  });

  // ── Log to adminLogs ──────────────────────────────────────────────────────
  const logRef = db.collection("adminLogs").doc();
  batch.set(logRef, {
    type:        "contest_finalized",
    contestId,
    contestTitle: contest.title,
    participants: totalParticipants,
    topThree:    eloLog.slice(0, 3),
    timestamp:   Timestamp.now(),
  });

  await batch.commit();

  // ── Auto-publish contest-exclusive challenges ────────────────────────────
  try {
    const challengeIds = contest.challengeIds || [];
    if (challengeIds.length > 0) {
      const publishBatch = db.batch();
      let publishCount = 0;
      for (const cid of challengeIds) {
        const cRef = db.collection("challenges").doc(cid);
        const cSnap = await cRef.get();
        if (cSnap.exists && cSnap.data().visibility === "contest") {
          publishBatch.update(cRef, {
            visibility: "public",
            isActive: true,
            updatedAt: Timestamp.now(),
          });
          publishCount++;
        }
      }
      if (publishCount > 0) {
        await publishBatch.commit();
        console.log(`Auto-published ${publishCount} contest-exclusive challenges for ${contestId}.`);
      }
    }
  } catch (pubErr) {
    console.error("Failed to auto-publish contest challenges:", pubErr);
  }

  // ── Generate certificates for top 3 ──────────────────────────────────────
  try {
    const certBatch = db.batch();
    const top3 = eloLog.filter(e => e.rank <= 3 && (e.score || 0) > 0);

    for (const entry of top3) {
      const certId = `contest_${contestId}_rank${entry.rank}`;
      const certRef = db.collection("certifications").doc(certId);

      const certData = {
        type: "contest",
        contestId,
        contestTitle: contest.title,
        userId: entry.userId,
        username: entry.username,
        rank: entry.rank,
        score: entry.score,
        eloAwarded: entry.eloAward,
        difficulty: contest.difficulty || "mixed",
        participantCount: totalParticipants,
        issuedAt: Timestamp.now(),
        verifyCode: `${contestId.slice(0, 6)}-${entry.rank}-${entry.userId.slice(0, 6)}`.toUpperCase(),
      };

      certBatch.set(certRef, certData);

      // Update user's certifications map
      certBatch.update(db.collection("users").doc(entry.userId), {
        [`certifications.${certId}`]: {
          type: "contest",
          title: contest.title,
          rank: entry.rank,
          issuedAt: Timestamp.now(),
        },
        totalCertificates: FieldValue.increment(1),
      });

      // Send certificate notification
      await sendNotification(entry.userId, {
        type: "certificate",
        title: "📜 Certificate Earned!",
        body: `You earned a certificate for placing #${entry.rank} in ${contest.title}. Verify: ${certData.verifyCode}`,
        link: `/cert/${certId}`,
      });
    }

    if (top3.length > 0) {
      await certBatch.commit();
      console.log(`Generated ${top3.length} certificates for contest ${contestId}.`);
    }
  } catch (certErr) {
    console.error("Failed to generate certificates:", certErr);
  }

  // ── Notify participants of results ───────────────────────────────────────
  try {
    for (const entry of eloLog.slice(0, 50)) {
      const rankLabel = entry.rank <= 3
        ? ["🥇 1st Place!", "🥈 2nd Place!", "🥉 3rd Place!"][entry.rank - 1]
        : `Rank #${entry.rank}`;
      await sendNotification(entry.userId, {
        type: "contest_result",
        title: `${rankLabel} — ${contest.title}`,
        body: entry.eloAward > 0
          ? `Score: ${entry.score} pts · +${entry.eloAward} ELO awarded`
          : `Score: ${entry.score} pts`,
        link: `/contests/${contestId}`,
      });
    }
  } catch (notifErr) {
    console.error("Failed to send contest result notifications:", notifErr);
  }

  console.log(`Contest ${contestId} finalized. ${totalParticipants} participants, top score: ${ranked[0]?.score ?? 0}`);
}

// ── ELO award calculator ──────────────────────────────────────────────────────
function getEloAward(rank, total, diffMult) {
  // Fixed podium
  if (rank === 1) return Math.round(150 * diffMult);
  if (rank === 2) return Math.round(100 * diffMult);
  if (rank === 3) return Math.round(75  * diffMult);

  const pct = rank / total;

  let base = 0;
  if (pct <= 0.10) base = 50;
  else if (pct <= 0.25) base = 30;
  else if (pct <= 0.50) base = 15;
  else base = 5; // participated with at least 1 solve

  return Math.round(base * diffMult);
}