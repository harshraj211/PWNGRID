/**
 * sendAdminNotification.js
 * HTTPS Callable — admin sends a notification to all users or specific users.
 *
 * File location: functions/src/admin/sendAdminNotification.js
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore }       = require("firebase-admin/firestore");
const { sendNotification, sendBulkNotification } = require("../lib/sendNotification");

const db = getFirestore();

exports.sendAdminNotification = onCall({ enforceAppCheck: false }, async (request) => {
  const { auth } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Must be signed in.");

  // Check admin role
  const userId = auth.uid;
  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  const role = userSnap.data().role;
  if (role !== "admin" && role !== "mod" && role !== "moderator") {
    throw new HttpsError("permission-denied", "Admin or moderator role required.");
  }

  const { title, body, type, link, audience, targetUserIds } = request.data;
  if (!title) throw new HttpsError("invalid-argument", "title is required.");

  const notifType = type || "admin";
  const notifOpts = { type: notifType, title, body: body || "", link: link || null };

  if (targetUserIds && Array.isArray(targetUserIds) && targetUserIds.length > 0) {
    // Send to specific users
    await sendBulkNotification(targetUserIds, notifOpts);
    return { success: true, count: targetUserIds.length };
  }

  // Audience-filtered broadcast
  let usersQuery = db.collection("users");
  let usersSnap;
  if (audience === "pro") {
    usersSnap = await usersQuery.where("isPro", "==", true).get();
  } else if (audience === "free") {
    usersSnap = await usersQuery.where("isPro", "==", false).get();
  } else {
    usersSnap = await usersQuery.get();
  }

  const allUserIds = usersSnap.docs.map(d => d.id);

  // Batch in groups of 500 (Firestore batch limit)
  for (let i = 0; i < allUserIds.length; i += 500) {
    const chunk = allUserIds.slice(i, i + 500);
    await sendBulkNotification(chunk, notifOpts);
  }

  return { success: true, count: allUserIds.length };
});
