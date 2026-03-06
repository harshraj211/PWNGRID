/**
 * sendBroadcast.js
 * Cloud Function — HTTPS Callable (Admin only)
 *
 * Sends a broadcast email to ALL users or a filtered subset.
 * Protected by admin role claim check.
 *
 * Input:
 *  {
 *    subject:   string         (required)
 *    bodyHtml:  string         (required — HTML content)
 *    filter?:   "all" | "pro" | "free"  (default: "all")
 *    dryRun?:   boolean        (default: false — if true, returns count without sending)
 *  }
 *
 * Output:
 *  { success: true, recipientCount: number, sent: number, failed: number }
 *
 * File location: functions/src/emails/sendBroadcast.js
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { sendBulkEmails, broadcastTemplate } = require("../lib/sendgrid");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 400; // Firestore pagination

module.exports = functions.https.onCall(async (data, context) => {

  // ── 1. Admin auth check ───────────────────────────────────────────────────
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be logged in.");
  }

  // Check JWT custom claim first, fallback to Firestore role field
  let tokenRole = context.auth.token.role;
  if (tokenRole !== "admin") {
    const callerSnap = await db.collection("users").doc(context.auth.uid).get();
    if (callerSnap.exists) tokenRole = callerSnap.data().role || "user";
  }
  if (tokenRole !== "admin") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Admin role required."
    );
  }

  // ── 2. Input validation ───────────────────────────────────────────────────
  const {
    subject,
    bodyHtml,
    filter = "all",
    dryRun = false,
  } = data;

  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "subject is required.");
  }
  if (!bodyHtml || typeof bodyHtml !== "string" || bodyHtml.trim().length === 0) {
    throw new functions.https.HttpsError("invalid-argument", "bodyHtml is required.");
  }
  if (!["all", "pro", "free"].includes(filter)) {
    throw new functions.https.HttpsError("invalid-argument", "filter must be all, pro, or free.");
  }
  if (subject.length > 200) {
    throw new functions.https.HttpsError("invalid-argument", "subject too long (max 200 chars).");
  }

  // ── 3. Collect all recipient emails (paginated) ───────────────────────────
  const recipients = [];
  let lastDoc = null;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection("users").orderBy("__name__").limit(BATCH_SIZE);

    // Apply plan filter
    if (filter === "pro") {
      query = db.collection("users").where("plan", "==", "pro").orderBy("__name__").limit(BATCH_SIZE);
    } else if (filter === "free") {
      query = db.collection("users").where("plan", "!=", "pro").orderBy("__name__").limit(BATCH_SIZE);
    }

    if (lastDoc) query = query.startAfter(lastDoc);

    const snap = await query.get();
    if (snap.empty) { hasMore = false; break; }

    snap.docs.forEach((doc) => {
      const user = doc.data();
      // Only include verified users with an email
      if (user.email && user.emailVerified !== false) {
        recipients.push({
          email: user.email,
          username: user.username || "Analyst",
        });
      }
    });

    lastDoc = snap.docs[snap.docs.length - 1];
    hasMore = snap.docs.length === BATCH_SIZE;
  }

  console.log(`sendBroadcast: ${recipients.length} recipients (filter: ${filter}, dryRun: ${dryRun})`);

  // ── 4. Dry run — return count without sending ─────────────────────────────
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      recipientCount: recipients.length,
      sent: 0,
      failed: 0,
      message: `Dry run complete. Would send to ${recipients.length} users.`,
    };
  }

  // ── 5. Send emails ─────────────────────────────────────────────────────────
  const { sent, failed } = await sendBulkEmails(
    recipients,
    subject.trim(),
    () => broadcastTemplate({ subject: subject.trim(), bodyHtml: bodyHtml.trim() })
  );

  // ── 6. Log broadcast to adminLogs ─────────────────────────────────────────
  await db.collection("adminLogs").add({
    type: "broadcast_email",
    subject: subject.trim(),
    filter,
    recipientCount: recipients.length,
    sent,
    failed,
    sentBy: context.auth.uid,
    executedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`sendBroadcast: done — sent: ${sent}, failed: ${failed}`);

  return {
    success: true,
    dryRun: false,
    recipientCount: recipients.length,
    sent,
    failed,
  };
});