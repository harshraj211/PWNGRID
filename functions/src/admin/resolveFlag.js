/**
 * resolveFlag.js
 * Cloud Function — HTTPS Callable (Admin/Moderator)
 *
 * Allows admins/moderators to review and resolve flagged accounts.
 * Actions: dismiss (false positive) | warn | ban
 *
 * Input:
 *  {
 *    flagId:   string                          (required)
 *    action:   "dismiss" | "warn" | "ban"      (required)
 *    notes?:   string                          (optional — reviewer notes)
 *  }
 *
 * Output:
 *  { success: true, action: string, targetUserId: string }
 *
 * File location: functions/src/admin/resolveFlag.js
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const VALID_ACTIONS = ["dismiss", "warn", "ban"];

module.exports = functions.https.onCall(async (data, context) => {

  // ── 1. Auth check (admin or moderator) ───────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }
  // Check JWT custom claim first, fallback to Firestore role field
  let role = context.auth.token.role;
  if (role !== "admin" && role !== "moderator") {
    const callerSnap = await db.collection("users").doc(context.auth.uid).get();
    if (callerSnap.exists) role = callerSnap.data().role || "user";
  }
  if (role !== "admin" && role !== "moderator") {
    throw new functions.https.HttpsError("permission-denied", "Admin or moderator role required.");
  }

  // ── 2. Input validation ───────────────────────────────────────────────────
  const { flagId, action, notes = "" } = data;

  if (!flagId || typeof flagId !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "flagId is required.");
  }
  if (!VALID_ACTIONS.includes(action)) {
    throw new functions.https.HttpsError("invalid-argument", `action must be one of: ${VALID_ACTIONS.join(", ")}`);
  }

  // ── 3. Fetch flag doc ─────────────────────────────────────────────────────
  const flagRef = db.collection("flags").doc(flagId);
  const flagSnap = await flagRef.get();

  if (!flagSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Flag not found.");
  }

  const flag = flagSnap.data();

  if (flag.resolvedAt) {
    throw new functions.https.HttpsError("failed-precondition", "This flag has already been resolved.");
  }

  const targetUserId = flag.userId;
  const userRef = db.collection("users").doc(targetUserId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Flagged user not found.");
  }

  // ── 4. Execute action ─────────────────────────────────────────────────────
  const batch = db.batch();
  const resolvedAt = FieldValue.serverTimestamp();

  // Update flag as resolved
  batch.update(flagRef, {
    action,
    notes: notes.trim(),
    reviewedBy: context.auth.uid,
    resolvedAt,
  });

  // Apply consequence to user based on action
  switch (action) {

    case "dismiss":
      // False positive — clear the flag from user doc
      batch.update(userRef, {
        isFlagged: false,
        flagReason: FieldValue.delete(),
      });
      break;

    case "warn":
      // Keep flagged but add a warning record
      batch.update(userRef, {
        isFlagged: false, // Clear active flag but keep history
        warningCount: FieldValue.increment(1),
        lastWarnedAt: resolvedAt,
        lastWarnReason: flag.reason,
      });
      break;

    case "ban":
      // Disable account — auth ban done separately via Admin SDK
      batch.update(userRef, {
        isFlagged: true,
        isBanned: true,
        bannedAt: resolvedAt,
        bannedBy: context.auth.uid,
        bannedReason: notes.trim() || flag.reason,
      });
      break;
  }

  // Log to adminLogs
  batch.set(db.collection("adminLogs").doc(), {
    type: "flag_resolved",
    flagId,
    targetUserId,
    targetUsername: userSnap.data().username || "unknown",
    action,
    notes: notes.trim(),
    originalFlagReason: flag.reason,
    performedBy: context.auth.uid,
    performedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // ── 5. If ban — disable Firebase Auth account ─────────────────────────────
  if (action === "ban") {
    try {
      await getAuth().updateUser(targetUserId, { disabled: true });
      console.log(`resolveFlag: banned and disabled auth for user ${targetUserId}`);
    } catch (err) {
      // Non-fatal — Firestore ban is already applied
      console.error(`resolveFlag: could not disable auth for ${targetUserId}`, err.message);
    }
  }

  console.log(`resolveFlag: flag ${flagId} resolved with action "${action}" by ${context.auth.uid}`);

  return {
    success: true,
    action,
    targetUserId,
    targetUsername: userSnap.data().username,
  };
});