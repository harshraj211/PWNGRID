/**
 * ChallengeSolve.jsx
 * The core challenge solving page — three-panel layout:
 *   LEFT:   Challenge description (markdown), hint, tool hint
 *   RIGHT:  Answer input, submission, result feedback
 *   TOP BAR: Challenge meta, timer, difficulty, back button
 *
 * Calls Cloud Functions: openChallenge + submitAnswer
 *
 * File location: frontend/src/pages/ChallengeSolve.jsx
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import Navbar from "../components/layout/Navbar";
import WriteupEditor from "../components/writeups/WriteupEditor";
import "./ChallengeSolve.css";

const openChallengeFn  = httpsCallable(functions, "openChallenge");
const submitAnswerFn   = httpsCallable(functions, "submitAnswer");
const unlockHintFn     = httpsCallable(functions, "unlockHint");

// Difficulty config
const DIFFICULTY = {
  easy:   { label: "Easy",   color: "var(--color-easy)",   bg: "rgba(0,255,136,0.08)" },
  medium: { label: "Medium", color: "var(--color-medium)", bg: "rgba(255,149,0,0.08)" },
  hard:   { label: "Hard",   color: "var(--color-hard)",   bg: "rgba(255,77,77,0.08)" },
};

export default function ChallengeSolve() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { currentUser, userProfile, canSolveToday } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [challenge, setChallenge]         = useState(null);
  const [challengeId, setChallengeId]     = useState(null);
  const [pageLoading, setPageLoading]     = useState(true);
  const [pageError, setPageError]         = useState("");

  const [answer, setAnswer]               = useState("");
  const [hintUsed, setHintUsed]           = useState(false);
  const [hintVisible, setHintVisible]     = useState(false);
  const [submitting, setSubmitting]       = useState(false);
  const [submitError, setSubmitError]     = useState("");

  const [result, setResult]               = useState(null); // { correct, eloChange, streak, breakdown, ... }
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const [showWriteup, setShowWriteup]           = useState(false);

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);
  const openedAtRef = useRef(null);

  // Start Challenge gate — user must explicitly click to start
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [flagFormat, setFlagFormat] = useState(null);
  const [alreadySolved, setAlreadySolved] = useState(false);

  // Panel resize
  const [leftWidth, setLeftWidth]   = useState(50); // percent
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  // ── Load challenge metadata (no session yet) ─────────────────────────────
  useEffect(() => {
    if (!slug) return;
    loadChallenge();
    return () => clearInterval(timerRef.current);
  }, [slug]);

  async function loadChallenge() {
    setPageLoading(true);
    setPageError("");

    try {
      // Find challenge by slug
      const { getDocs, collection, query, where, limit } = await import("firebase/firestore");
      const q = query(
        collection(db, "challenges"),
        where("slug", "==", slug),
        where("isActive", "==", true),
        where("isDeleted", "==", false)
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        setPageError("Challenge not found.");
        setPageLoading(false);
        return;
      }

      const challengeDoc = snap.docs[0];
      const data = challengeDoc.data();
      const docId = challengeDoc.id;
      setChallengeId(docId);
      setChallenge(data);
      setFlagFormat(data.flagFormat || null);

      // Check if user already solved this challenge — skip start gate if so
      if (currentUser?.uid) {
        const submSnap = await getDocs(query(
          collection(db, "submissions"),
          where("userId", "==", currentUser.uid),
          where("challengeId", "==", docId),
          where("correct", "==", true),
          limit(1)
        ));
        if (!submSnap.empty) {
          setAlreadySolved(true);
          setChallengeStarted(true);
          setResult({ correct: true, alreadySolved: true, eloChange: 0 });
        }
      }

    } catch (err) {
      setPageError(err.message || "Failed to load challenge.");
    } finally {
      setPageLoading(false);
    }
  }

  // ── Start Challenge — opens server session + starts timer ─────────────────
  async function handleStartChallenge() {
    if (!challengeId) return;

    // Investigation challenges — hand off to the investigation board
    if (challenge?.type === "investigation") {
      navigate(`/investigate/${challengeId}?autostart=1`);
      return;
    }

    try {
      const res = await openChallengeFn({ challengeId });
      const serverTimestamp = res.data?.openTimestamp || Date.now();
      openedAtRef.current = serverTimestamp;
      setChallengeStarted(true);

      // Pick up flagFormat from server response too
      if (res.data?.challengeMeta?.flagFormat) {
        setFlagFormat(res.data.challengeMeta.flagFormat);
      }

      // If already solved, show read-only view immediately
      if (res.data?.alreadySolved) {
        setAlreadySolved(true);
        setResult({ correct: true, alreadySolved: true, eloChange: 0 });
        return; // don't start timer
      }

      // Start elapsed timer using server openTimestamp
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - openedAtRef.current) / 1000));
      }, 1000);
    } catch (err) {
      console.error("Failed to start challenge:", err);
      // Still allow the user to proceed — start a client-side timer as fallback
      openedAtRef.current = Date.now();
      setChallengeStarted(true);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - openedAtRef.current) / 1000));
      }, 1000);
    }
  }

  // ── Submit answer ─────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (!answer.trim() || submitting || rateLimitSeconds > 0) return;

    // Free tier daily limit check
    if (!canSolveToday()) {
      setSubmitError("Daily limit reached (5 challenges/day). Upgrade to Pro for unlimited access.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    setResult(null);

    try {
      const res = await submitAnswerFn({
        challengeId,
        answer: answer.trim(),
        // hintUsed is NOT sent — server reads it from activeSession
        contestId: null,
      });

      const data = res.data;
      setResult(data);

      if (data.correct) {
        clearInterval(timerRef.current); // Stop timer on correct
      } else {
        setWrongAttempts((w) => w + 1);
        setAnswer(""); // Clear input on wrong
      }

    } catch (err) {
      const code = err.code;
      if (code === "functions/resource-exhausted") {
        // Rate limited — parse retry seconds from message
        const match = err.message.match(/(\d+)s/);
        const secs = match ? parseInt(match[1]) : 60;
        setRateLimitSeconds(secs);
        startRateLimitCountdown(secs);
        setSubmitError(`Too many attempts. Try again in ${secs} seconds.`);
      } else {
        const msg = err.message || "Submission failed. Please try again.";
        if (msg === "internal" || code === "functions/internal") {
          setSubmitError("Could not reach the server. Please check your connection and try again.");
        } else {
          setSubmitError(msg);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function startRateLimitCountdown(seconds) {
    const interval = setInterval(() => {
      setRateLimitSeconds((s) => {
        if (s <= 1) { clearInterval(interval); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  // ── Hint reveal — calls server to set hintUsed on session ───────────────
  const [hintLoading, setHintLoading] = useState(false);
  const [hintText, setHintText]       = useState(null);

  async function handleRevealHint() {
    if (hintLoading) return;
    setHintLoading(true);
    try {
      const res = await unlockHintFn({ challengeId });
      setHintText(res.data.hint);
      setHintVisible(true);
      setHintUsed(true); // UI state only — actual penalty tracked server-side
    } catch (err) {
      console.error("Failed to unlock hint:", err);
    } finally {
      setHintLoading(false);
    }
  }

  // ── Panel drag resize ─────────────────────────────────────────────────────
  function handleDividerMouseDown(e) {
    e.preventDefault();
    isDragging.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftWidth(Math.min(75, Math.max(25, pct)));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  // ── Keyboard shortcut: Ctrl+Enter to submit ───────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (answer.trim() && !submitting && !result?.correct) {
          handleSubmit(e);
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [answer, submitting, result]);

  // ── Render states ─────────────────────────────────────────────────────────
  if (pageLoading) return <LoadingScreen />;
  if (pageError)   return <ErrorScreen error={pageError} onBack={() => navigate("/challenges")} />;
  if (!challenge)  return null;

  const diff = DIFFICULTY[challenge.difficulty] || DIFFICULTY.easy;

  // ── Pre-start screen — show challenge overview with "Start Challenge" button ──
  if (!challengeStarted) {
    return (
      <div className="solve-shell">
        <Navbar />
        <div className="solve-topbar">
          <button className="solve-back-btn" onClick={() => navigate("/challenges")}>
            ← Challenges
          </button>
          <div className="solve-topbar-center">
            <h1 className="solve-title">{challenge.title}</h1>
            <span
              className="solve-difficulty-badge"
              style={{ color: diff.color, background: diff.bg }}
            >
              {diff.label}
            </span>
          </div>
          <div className="solve-topbar-right" />
        </div>

        <div className="solve-start-screen">
          <div className="solve-start-card">
            <div className="solve-start-icon">🔍</div>
            <h2 className="solve-start-heading">{challenge.title}</h2>
            <div className="solve-start-meta">
              <span className="solve-start-diff" style={{ color: diff.color }}>
                {diff.label}
              </span>
              <span className="solve-start-sep">•</span>
              <span className="solve-start-pts">+{challenge.basePoints} ELO</span>
              {challenge.expectedTime && (
                <>
                  <span className="solve-start-sep">•</span>
                  <span className="solve-start-time">~{formatTime(challenge.expectedTime)}</span>
                </>
              )}
            </div>
            {flagFormat && (
              <div className="solve-start-flag-format">
                <span className="solve-start-flag-label">Flag format:</span>
                <code className="solve-start-flag-code">{flagFormat}</code>
              </div>
            )}
            <p className="solve-start-desc">
              Click the button below to start the challenge. Your timer will begin once you start.
            </p>
            <button className="solve-start-btn" onClick={handleStartChallenge}>
              ▶ Start Challenge
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="solve-shell">
      <Navbar />

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="solve-topbar">
        <button className="solve-back-btn" onClick={() => navigate("/challenges")}>
          ← Challenges
        </button>

        <div className="solve-topbar-center">
          <h1 className="solve-title">{challenge.title}</h1>
          <span
            className="solve-difficulty-badge"
            style={{ color: diff.color, background: diff.bg }}
          >
            {diff.label}
          </span>
        </div>

        <div className="solve-topbar-right">
          {/* Elapsed timer — hidden after correct solve */}
          {!result?.correct && (
            <div className="solve-timer" title="Time elapsed">
              <span className="solve-timer-icon">⏱</span>
              <span className="solve-timer-value">{formatTime(elapsedSeconds)}</span>
            </div>
          )}

          {/* Wrong attempts counter */}
          {wrongAttempts > 0 && (
            <div className="solve-attempts" title="Wrong attempts">
              <span style={{ color: "var(--color-error)" }}>✗ {wrongAttempts}</span>
            </div>
          )}

          {/* Expected time hint */}
          <div className="solve-expected" title="Expected solve time">
            <span className="solve-expected-label">Expected</span>
            <span className="solve-expected-value">{formatTime(challenge.expectedTime)}</span>
          </div>
        </div>
      </div>

      {/* ── Three panel layout ────────────────────────────────────────────── */}
      <div className="solve-panels" ref={containerRef}>

        {/* ── LEFT: Problem description ──────────────────────────────────── */}
        <div className="solve-panel solve-panel--left" style={{ width: `${leftWidth}%` }}>
          <div className="solve-panel-inner">

            {/* Problem statement */}
            <section className="solve-section">
              <div className="solve-section-header">
                <span className="solve-section-label">Mission Brief</span>
              </div>
              <div className="solve-markdown">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{challenge.description}</ReactMarkdown>
              </div>
            </section>

            {/* Media attachment */}
            {challenge.mediaURL && (
              <section className="solve-section">
                <div className="solve-section-header">
                  <span className="solve-section-label">Attached File</span>
                  <button
                    type="button"
                    className="solve-media-download"
                    title="Download original file with metadata intact"
                    onClick={() => downloadMedia(challenge.mediaURL, challenge.mediaFilename)}
                  >
                    ↓ Download Original
                  </button>
                </div>
                <div className="solve-media-wrap">
                  {challenge.mediaType === "image" && (
                    <img
                      src={challenge.mediaURL}
                      alt="Challenge media"
                      className="solve-media-image"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.parentElement.innerHTML = '<div class="solve-media-error">⚠ Image failed to load — use the Download button above.</div>';
                      }}
                    />
                  )}
                  {challenge.mediaType === "video" && (
                    <video controls className="solve-media-video">
                      <source src={challenge.mediaURL} />
                      Your browser does not support video.
                    </video>
                  )}
                  {challenge.mediaType === "audio" && (
                    <audio controls className="solve-media-audio">
                      <source src={challenge.mediaURL} />
                    </audio>
                  )}
                  {(challenge.mediaType === "file" || (!["image","video","audio"].includes(challenge.mediaType))) && (
                    <div className="solve-media-file">
                      <span className="solve-media-file-icon">📎</span>
                      <div>
                        <div className="solve-media-file-name">{challenge.mediaFilename || "attached-file"}</div>
                        <div className="solve-media-file-hint">Download the file to analyse it — metadata preserved.</div>
                      </div>
                      <button type="button" className="solve-media-file-btn"
                        onClick={() => downloadMedia(challenge.mediaURL, challenge.mediaFilename)}>
                        Download
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Tool hint */}
            {challenge.toolHint && (
              <section className="solve-section">
                <div className="solve-section-header">
                  <span className="solve-section-label">Tool Category</span>
                </div>
                <div className="solve-tool-hint">
                  <span className="solve-tool-hint-icon">⚙</span>
                  {challenge.toolHint}
                </div>
              </section>
            )}

            {/* Hint */}
            {challenge.hint && (
              <section className="solve-section">
                <div className="solve-section-header">
                  <span className="solve-section-label">Hint</span>
                  {hintUsed && (
                    <span className="solve-hint-penalty-warning">−20% ELO</span>
                  )}
                </div>

                {hintVisible ? (
                  <div className="solve-hint-revealed">
                    <span className="solve-hint-icon">💡</span>
                    <p>{hintText || "Hint unlocked."}</p>
                  </div>
                ) : (
                  <button className="solve-hint-btn" onClick={handleRevealHint} disabled={hintLoading}>
                    {hintLoading ? "Unlocking..." : "Reveal hint"}
                    <span className="solve-hint-btn-penalty">−20% ELO penalty</span>
                  </button>
                )}
              </section>
            )}

            {/* Stats */}
            <section className="solve-stats-row">
              <div className="solve-stat">
                <span className="solve-stat-value">{challenge.solveCount ?? 0}</span>
                <span className="solve-stat-label">Solvers</span>
              </div>
              <div className="solve-stat">
                <span className="solve-stat-value">
                  {challenge.avgSolveTime ? formatTime(challenge.avgSolveTime) : "—"}
                </span>
                <span className="solve-stat-label">Avg time</span>
              </div>
              <div className="solve-stat">
                <span className="solve-stat-value" style={{ color: diff.color }}>
                  +{challenge.basePoints}
                </span>
                <span className="solve-stat-label">Base ELO</span>
              </div>
            </section>

          </div>
        </div>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div
          className="solve-divider"
          onMouseDown={handleDividerMouseDown}
          title="Drag to resize"
        >
          <div className="solve-divider-handle" />
        </div>

        {/* ── RIGHT: Answer + result ─────────────────────────────────────── */}
        <div className="solve-panel solve-panel--right" style={{ width: `${100 - leftWidth}%` }}>
          <div className="solve-panel-inner">

            {/* ── Already solved — show locked panel ─────────────────── */}
            {result?.correct && result?.alreadySolved && (
              <div className="solve-result solve-result--correct">
                <div className="solve-result-header">
                  <span className="solve-result-icon">✓</span>
                  <span className="solve-result-title">Already Solved</span>
                </div>
                <p style={{ color: "var(--color-text-muted)", fontSize: "0.9rem", margin: "0 0 16px" }}>
                  You've already completed this challenge. Flag submission is disabled.
                </p>
                <div className="solve-result-actions">
                  <button className="solve-next-btn" onClick={() => navigate("/challenges")}>
                    Back to challenges →
                  </button>
                  <button
                    className={`solve-writeup-btn ${showWriteup ? "solve-writeup-btn--active" : ""}`}
                    onClick={() => setShowWriteup(v => !v)}
                  >
                    📝 {showWriteup ? "Hide write-up" : "View write-up"}
                  </button>
                </div>
                {showWriteup && challengeId && (
                  <WriteupEditor
                    challengeId={challengeId}
                    challengeTitle={challenge?.title}
                    onClose={() => setShowWriteup(false)}
                  />
                )}
              </div>
            )}

            {/* ── Result display (correct) ──────────────────────────────── */}
            {result?.correct && !result?.alreadySolved && (
              <div className="solve-result solve-result--correct">
                <div className="solve-result-header">
                  <span className="solve-result-icon">✓</span>
                  <span className="solve-result-title">
                    {alreadySolved ? "Correct (Practice)" : "Correct!"}
                  </span>
                </div>

                {!alreadySolved && (
                  <>
                    <div className="solve-elo-gain">
                      <span className="solve-elo-gain-value">+{result.eloChange}</span>
                      <span className="solve-elo-gain-label">ELO</span>
                    </div>

                    {/* Breakdown */}
                    <div className="solve-breakdown">
                      <BreakdownRow
                        label="Base ELO"
                        value={`+${result.breakdown?.baseElo}`}
                      />
                      <BreakdownRow
                        label="Time bonus"
                        value={`×${result.breakdown?.timeBonus?.toFixed(2)}`}
                        highlight={result.breakdown?.timeBonus >= 1.5}
                      />
                      {result.breakdown?.hintPenalty < 1 && (
                        <BreakdownRow
                          label="Hint penalty"
                          value={`×${result.breakdown?.hintPenalty}`}
                          negative
                        />
                      )}
                      {result.breakdown?.attemptPenalty < 1 && (
                        <BreakdownRow
                          label="Attempt penalty"
                          value={`×${result.breakdown?.attemptPenalty?.toFixed(2)}`}
                          negative
                        />
                      )}
                    </div>

                    {/* Streak */}
                    {result.streak?.changed && (
                      <div className="solve-streak-update">
                        <span className="solve-streak-icon">🔥</span>
                        <span>
                          {result.streak.action === "incremented"
                            ? `Streak extended to ${result.streak.current} days`
                            : `New streak started: ${result.streak.current} day`
                          }
                        </span>
                      </div>
                    )}

                    <div className="solve-result-time">
                      Solved in {formatTime(result.timeTaken)}
                    </div>
                  </>
                )}

                <div className="solve-result-actions">
                  <button
                    className="solve-next-btn"
                    onClick={() => navigate("/challenges")}
                  >
                    Back to challenges →
                  </button>
                  <button
                    className={`solve-writeup-btn ${showWriteup ? "solve-writeup-btn--active" : ""}`}
                    onClick={() => setShowWriteup(v => !v)}
                  >
                    📝 {showWriteup ? "Hide write-up" : "Add write-up"}
                  </button>
                </div>

                {showWriteup && challengeId && (
                  <WriteupEditor
                    challengeId={challengeId}
                    challengeTitle={challenge?.title}
                    onClose={() => setShowWriteup(false)}
                  />
                )}
              </div>
            )}

            {/* ── Answer form (shown until correct) ─────────────────────── */}
            {!result?.correct && (
              <form onSubmit={handleSubmit} className="solve-form" noValidate>
                <div className="solve-form-header">
                  <span className="solve-form-label">Submit Answer</span>
                  <span className="solve-form-hint">Ctrl+Enter to submit</span>
                </div>

                {/* Wrong answer feedback */}
                {result?.correct === false && (
                  <div className="solve-wrong-feedback">
                    <span className="solve-wrong-icon">✗</span>
                    <div>
                      <span className="solve-wrong-text">Incorrect answer</span>
                      <span className="solve-wrong-elo">{result.eloChange} ELO</span>
                    </div>
                    <span className="solve-attempts-left">
                      {5 - result.attemptsInWindow} attempts left
                    </span>
                  </div>
                )}

                {/* Submit error */}
                {submitError && (
                  <div className="solve-submit-error">
                    <span>⚠</span> {submitError}
                  </div>
                )}

                {/* Answer input */}
                <div className="solve-input-group">
                  <input
                    type="text"
                    className="solve-answer-input"
                    placeholder={flagFormat ? `Format: ${flagFormat}` : "Enter your answer..."}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    disabled={submitting || rateLimitSeconds > 0}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </div>

                {/* Flag format hint */}
                {flagFormat && (
                  <div className="solve-flag-format-hint">
                    <span className="solve-flag-format-label">Flag format:</span>
                    <code className="solve-flag-format-code">{flagFormat}</code>
                  </div>
                )}

                {/* Rate limit bar */}
                {rateLimitSeconds > 0 && (
                  <div className="solve-ratelimit">
                    <span className="solve-ratelimit-icon">⏳</span>
                    <span>Rate limited — try again in {rateLimitSeconds}s</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="solve-submit-btn"
                  disabled={!answer.trim() || submitting || rateLimitSeconds > 0}
                >
                  {submitting ? (
                    <span className="solve-submit-loading">
                      <span className="solve-submit-spinner" />
                      Verifying...
                    </span>
                  ) : rateLimitSeconds > 0 ? (
                    `Wait ${rateLimitSeconds}s`
                  ) : (
                    "Submit Answer →"
                  )}
                </button>

                <p className="solve-submit-note">
                  Answers are case-insensitive and whitespace is trimmed automatically.
                </p>
              </form>
            )}

            {/* ── Wrong attempts history ─────────────────────────────────── */}
            {wrongAttempts > 0 && !result?.correct && (
              <div className="solve-attempt-counter">
                <span className="solve-attempt-label">Wrong attempts:</span>
                <div className="solve-attempt-pips">
                  {Array.from({ length: Math.min(wrongAttempts, 5) }).map((_, i) => (
                    <span key={i} className="solve-attempt-pip" />
                  ))}
                </div>
                <span className="solve-attempt-elo" style={{ color: "var(--color-error)" }}>
                  −{Math.min(wrongAttempts * 2, 10)} ELO so far
                </span>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BreakdownRow({ label, value, highlight, negative }) {
  return (
    <div className="solve-breakdown-row">
      <span className="solve-breakdown-label">{label}</span>
      <span
        className="solve-breakdown-value"
        style={{
          color: negative ? "var(--color-error)"
               : highlight ? "var(--color-accent)"
               : "var(--color-text-muted)"
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="solve-loading">
      <Navbar />
      <div className="solve-loading-body">
        <div className="solve-loading-spinner" />
        <span className="solve-loading-text">Loading challenge...</span>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onBack }) {
  return (
    <div className="solve-loading">
      <Navbar />
      <div className="solve-loading-body">
        <div className="solve-error-icon">⚠</div>
        <p className="solve-error-text">{error}</p>
        <button className="solve-back-btn" onClick={onBack}>← Back to challenges</button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Download a file from a cross-origin URL (e.g. Cloudinary) by fetching it
 * as a blob and triggering a browser download. This preserves original metadata
 * unlike the `download` attribute which is ignored for cross-origin URLs.
 */
function downloadMedia(url, filename) {
  const name = filename || url.split("/").pop()?.split("?")[0] || "download";
  const isCloudinary = url.includes("cloudinary.com");
  const isRaw = url.includes("/raw/upload/");

  const dlUrl = isCloudinary && !isRaw
    ? url.replace("/upload/", "/upload/fl_attachment/")
    : url;

  const a = document.createElement("a");
  a.href = dlUrl;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 500);
}