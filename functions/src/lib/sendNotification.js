/**
 * sendNotification.js
 * Helper to write to notifications/{userId}/items subcollection.
 * Can be called from any server-side function.
 *
 * Usage:
 *   const { sendNotification } = require("../lib/sendNotification");
 *   await sendNotification(userId, {
 *     type: "contest_result",
 *     title: "You placed #2!",
 *     body: "Contest XYZ results are in.",
 *   });
 *
 * File location: functions/src/lib/sendNotification.js
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const db = getFirestore();

/**
 * @param {string} userId
 * @param {Object} opts
 * @param {string} opts.type - contest_result | contest_reminder | badge | certificate | admin | flag_warning | elo_change | system
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string} [opts.link] - optional frontend link
 */
async function sendNotification(userId, { type, title, body, link }) {
  await db
    .collection("notifications")
    .doc(userId)
    .collection("items")
    .add({
      type:      type || "system",
      title:     title || "",
      body:      body || "",
      link:      link || null,
      read:      false,
      createdAt: FieldValue.serverTimestamp(),
    });
}

/**
 * Send same notification to multiple users.
 * @param {string[]} userIds
 * @param {Object} opts - same as sendNotification
 */
async function sendBulkNotification(userIds, opts) {
  const batch = db.batch();
  for (const uid of userIds) {
    const ref = db
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .doc();
    batch.set(ref, {
      type:      opts.type || "system",
      title:     opts.title || "",
      body:      opts.body || "",
      link:      opts.link || null,
      read:      false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

module.exports = { sendNotification, sendBulkNotification };
