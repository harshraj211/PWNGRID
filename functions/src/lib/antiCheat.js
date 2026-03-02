/**
 * antiCheat.js
 * Pure function — zero Firebase dependencies.
 * All flagging decisions made here; actual DB writes happen in submitAnswer.js
 */

/** Minimum solve time (seconds) before flagging as suspicious.
 *  These are soft flags only — a single fast solve is never hard-blocked.
 *  Legitimate flow: user pre-solved on notepad, opens page, pastes answer.
 *  Action only taken if user has MULTIPLE speed flags across different challenges.
 */
const SPEED_THRESHOLDS = {
  easy:   2,   // 2s — nearly impossible to be legitimate under this
  medium: 4,
  hard:   8,
};

/** Max attempts per challenge per rolling window.
 *  20 attempts / 5 min is CTF-friendly (typos, format guessing) while
 *  still blocking automated brute-force (thousands/min).
 */
const RATE_LIMIT = {
  maxAttempts: 20,
  windowSeconds: 5 * 60, // 5 minutes
};

/**
 * Checks if a submission is suspiciously fast.
 *
 * @param {Object} params
 * @param {number} params.timeTaken    - seconds (server-calculated)
 * @param {'easy'|'medium'|'hard'} params.difficulty
 * @returns {{ flagged: boolean, reason?: string }}
 */
function checkSpeedAnomaly({ timeTaken, difficulty }) {
  const threshold = SPEED_THRESHOLDS[difficulty];
  if (threshold === undefined) {
    return { flagged: false };
  }

  if (timeTaken < threshold) {
    return {
      flagged: true,
      reason: `Solved ${difficulty} challenge in ${timeTaken}s (threshold: ${threshold}s)`,
    };
  }

  return { flagged: false };
}

/**
 * Checks if a user has exceeded the rate limit for a challenge.
 * Caller must provide attempt timestamps from DB.
 *
 * @param {Object} params
 * @param {number[]} params.recentAttemptTimestamps - Unix timestamps (ms) of recent attempts
 * @param {number} params.nowMs                     - Current time in ms (Date.now())
 * @returns {{ limited: boolean, attemptsInWindow: number, retryAfterSeconds?: number }}
 */
function checkRateLimit({ recentAttemptTimestamps, nowMs }) {
  const windowMs = RATE_LIMIT.windowSeconds * 1000;
  const windowStart = nowMs - windowMs;

  const attemptsInWindow = recentAttemptTimestamps.filter(
    (ts) => ts >= windowStart
  ).length;

  if (attemptsInWindow >= RATE_LIMIT.maxAttempts) {
    // Find oldest attempt in window to calculate retry time
    const oldestInWindow = Math.min(
      ...recentAttemptTimestamps.filter((ts) => ts >= windowStart)
    );
    const retryAfterMs = oldestInWindow + windowMs - nowMs;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return {
      limited: true,
      attemptsInWindow,
      retryAfterSeconds,
    };
  }

  return {
    limited: false,
    attemptsInWindow,
  };
}

/**
 * Validates that timeTaken is plausible (guards against clock manipulation).
 * e.g. negative time or impossibly large values.
 *
 * @param {number} timeTaken - seconds
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTimeTaken(timeTaken) {
  if (typeof timeTaken !== "number" || isNaN(timeTaken)) {
    return { valid: false, reason: "timeTaken is not a number." };
  }
  if (timeTaken < 0) {
    return { valid: false, reason: "Negative timeTaken — clock manipulation suspected." };
  }
  // 24 hours max session time (matches activeSessions TTL)
  if (timeTaken > 86400) {
    return { valid: false, reason: "timeTaken exceeds 24h session TTL." };
  }
  return { valid: true };
}

/**
 * Validates that an IP address string is present and well-formed.
 * Lightweight check — not a full IP validator.
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIp(_ip) {
  if (!_ip || typeof _ip !== "string") return false;
  // Accepts IPv4 and IPv6
  return /^[\d.:a-fA-F]+$/.test(_ip) && _ip.length <= 45;
}

/**
 * Master anti-cheat check — runs all checks and returns a combined result.
 * Call this inside submitAnswer before processing.
 *
 * @param {Object} params
 * @param {number} params.timeTaken
 * @param {'easy'|'medium'|'hard'} params.difficulty
 * @param {number[]} params.recentAttemptTimestamps
 * @param {number} params.nowMs
 * @param {string} params.ip
 *
 * @returns {{
 *   shouldBlock: boolean,
 *   shouldFlag: boolean,
 *   blockReason?: string,
 *   flagReason?: string,
 *   rateLimitInfo: object
 * }}
 */
function runAntiCheatChecks({ timeTaken, difficulty, recentAttemptTimestamps, nowMs, ip }) {
  // 1. Validate time
  const timeValidation = validateTimeTaken(timeTaken);
  if (!timeValidation.valid) {
    return {
      shouldBlock: true,
      shouldFlag: true,
      blockReason: timeValidation.reason,
      flagReason: timeValidation.reason,
      rateLimitInfo: {},
    };
  }

  // 2. Rate limit check
  const rateLimit = checkRateLimit({ recentAttemptTimestamps, nowMs });
  if (rateLimit.limited) {
    return {
      shouldBlock: true,
      shouldFlag: false,
      blockReason: `Rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds}s.`,
      rateLimitInfo: rateLimit,
    };
  }

  // 3. Speed anomaly (flag but don't block — allow submission, mark suspicious)
  const speedCheck = checkSpeedAnomaly({ timeTaken, difficulty });

  return {
    shouldBlock: false,
    shouldFlag: speedCheck.flagged,
    flagReason: speedCheck.flagged ? speedCheck.reason : undefined,
    rateLimitInfo: rateLimit,
  };
}

module.exports = {
  runAntiCheatChecks,
  checkSpeedAnomaly,
  checkRateLimit,
  validateTimeTaken,
  isValidIp,
  SPEED_THRESHOLDS,
  RATE_LIMIT,
};