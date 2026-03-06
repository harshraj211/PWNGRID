/**
 * hashAnswer.js
 * Pure function — zero Firebase dependencies.
 *
 * Used by:
 *  - Admin panel: to hash correct answers before storing in Firestore
 *  - submitAnswer Cloud Function: to compare normalized submission against stored hash
 *
 * NEVER send the hash or the correct answer to the client.
 */

const crypto = require("crypto");
const { normalizeAnswer } = require("./normalizeAnswer");

/**
 * Hashes a normalized answer using SHA-256.
 *
 * @param {string} normalizedAnswer - Already normalized answer string
 * @returns {string} - Hex-encoded SHA-256 hash
 */
function hashAnswer(normalizedAnswer) {
  if (typeof normalizedAnswer !== "string" || normalizedAnswer.length === 0) {
    throw new Error("Cannot hash an empty or non-string answer.");
  }
  // Collapse whitespace to single space + append salt to match frontend hash
  const collapsed = normalizedAnswer.replace(/\s+/g, " ");
  const salted    = collapsed + "osint-arena-salt-2024";
  return crypto.createHash("sha256").update(salted).digest("hex");
}

/**
 * Full pipeline: normalize then hash.
 * Use this when storing a new challenge answer in admin panel.
 *
 * @param {string} rawAnswer
 * @param {Object} [rules] - normalization rules from challenge doc
 * @returns {string} - SHA-256 hex hash
 */
function hashRawAnswer(rawAnswer, rules = {}) {
  const normalized = normalizeAnswer(rawAnswer, rules);
  return hashAnswer(normalized);
}

/**
 * Validates a user's submission against a stored answer hash.
 * This is the ONLY place answer comparison happens — server-side only.
 *
 * @param {string} rawSubmission       - Raw answer from user
 * @param {string} storedHash          - SHA-256 hash from challenge doc
 * @param {Object} [normalizationRules] - Rules from challenge doc
 * @returns {boolean}
 */
function verifyAnswer(rawSubmission, storedHash, normalizationRules = {}) {
  try {
    const normalized = normalizeAnswer(rawSubmission, normalizationRules);
    const submissionHash = hashAnswer(normalized);
    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(submissionHash, "hex"),
      Buffer.from(storedHash, "hex")
    );
  } catch {
    return false;
  }
}

module.exports = {
  hashAnswer,
  hashRawAnswer,
  verifyAnswer,
};