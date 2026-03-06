/**
 * InvestigationChallenge.jsx
 * Full-page wrapper for investigation-type challenges.
 *
 * View modes:
 *  - "briefing"   → full-screen challenge description
 *  - "split"      → left sidebar (brief) + right graph canvas
 *  - "fullscreen" → graph canvas fills the screen
 *
 * File location: frontend/src/pages/InvestigationChallenge.jsx
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc, getDocs, collection, query, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import InvestigationBoard from "../components/investigation/InvestigationBoard";
import "./InvestigationChallenge.css";

const openChallengeFn = httpsCallable(functions, "openChallenge");
const submitAnswerFn  = httpsCallable(functions, "submitAnswer");

const DIFF_CONFIG = {
  easy:   { color: "var(--color-easy)",   label: "Easy" },
  medium: { color: "var(--color-medium)", label: "Medium" },
  hard:   { color: "var(--color-hard)",   label: "Hard" },
};

export default function InvestigationChallenge() {
  const { challengeId } = useParams();
  const navigate        = useNavigate();
  const { currentUser, canSolveToday } = useAuth();

  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [eloTotal, setEloTotal]   = useState(0);

  // "briefing" | "split" | "fullscreen"
  const [viewMode, setViewMode] = useState("briefing");

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);
  const openedAtRef = useRef(null);
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [flagFormat, setFlagFormat] = useState(null);

  // Flag submission state
  const [flagAnswer, setFlagAnswer]         = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);
  const [flagResult, setFlagResult]         = useState(null);
  const [flagError, setFlagError]           = useState("");
  const [wrongAttempts, setWrongAttempts]   = useState(0);
  const [rateLimitSecs, setRateLimitSecs]   = useState(0);

  // Flag submission handler
  const handleFlagSubmit = useCallback(async (e) => {
    e?.preventDefault();
    if (!flagAnswer.trim() || flagSubmitting || rateLimitSecs > 0) return;

    if (canSolveToday && !canSolveToday()) {
      setFlagError("Daily limit reached. Upgrade to Pro for unlimited access.");
      return;
    }

    setFlagSubmitting(true);
    setFlagError("");
    setFlagResult(null);

    try {
      const res = await submitAnswerFn({
        challengeId,
        answer: flagAnswer.trim(),
        contestId: null,
      });
      const data = res.data;
      setFlagResult(data);

      if (data.correct) {
        setEloTotal(t => t + (data.eloChange || 0));
      } else {
        setWrongAttempts(w => w + 1);
        setFlagAnswer("");
      }
    } catch (err) {
      const code = err.code;
      if (code === "functions/resource-exhausted") {
        const match = err.message.match(/(\d+)s/);
        const secs = match ? parseInt(match[1]) : 60;
        setRateLimitSecs(secs);
        const interval = setInterval(() => {
          setRateLimitSecs(s => {
            if (s <= 1) { clearInterval(interval); return 0; }
            return s - 1;
          });
        }, 1000);
        setFlagError(`Too many attempts. Try again in ${secs}s.`);
      } else {
        const msg = err.message || "Submission failed.";
        if (msg === "internal" || code === "functions/internal") {
          setFlagError("Could not reach the server. Please check your connection and try again.");
        } else {
          setFlagError(msg);
        }
      }
    } finally {
      setFlagSubmitting(false);
    }
  }, [flagAnswer, flagSubmitting, rateLimitSecs, challengeId, canSolveToday]);

  useEffect(() => {
    async function init() {
      try {
        const snap = await getDoc(doc(db, "challenges", challengeId));
        if (!snap.exists()) { setError("Challenge not found."); return; }
        const data = { id: snap.id, ...snap.data() };
        if (data.type !== "investigation") {
          navigate(`/challenges/${challengeId}`);
          return;
        }
        setChallenge(data);
        setFlagFormat(data.flagFormat || null);

        // Check if user already solved this challenge — skip briefing if so
        let isAlreadySolved = false;
        if (currentUser?.uid) {
          const submSnap = await getDocs(query(
            collection(db, "submissions"),
            where("userId", "==", currentUser.uid),
            where("challengeId", "==", snap.id),
            where("correct", "==", true),
            limit(1)
          ));
          if (!submSnap.empty) {
            isAlreadySolved = true;
            setFlagResult({ correct: true, eloChange: 0, alreadySolved: true });
            setViewMode("split");
          }
        }

        // Auto-start when coming from the "Start Challenge" gateway
        if (!isAlreadySolved) {
          const urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get("autostart") === "1") {
            handleStartInvestigation();
          }
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load challenge.");
      } finally {
        setLoading(false);
      }
    }
    init();
    return () => clearInterval(timerRef.current);
  }, [challengeId, navigate]);

  // Start Investigation — opens server session + starts timer
  async function handleStartInvestigation() {
    try {
      const res = await openChallengeFn({ challengeId });

      // Already solved on server — skip timer, show solved state
      if (res.data?.alreadySolved) {
        setFlagResult({ correct: true, eloChange: 0, alreadySolved: true });
        setViewMode("split");
        return;
      }

      const serverTimestamp = res.data?.openTimestamp || Date.now();
      openedAtRef.current = serverTimestamp;
      setChallengeStarted(true);

      if (res.data?.challengeMeta?.flagFormat) {
        setFlagFormat(res.data.challengeMeta.flagFormat);
      }

      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - openedAtRef.current) / 1000));
      }, 1000);

      setViewMode("split");
    } catch (err) {
      console.error("Failed to start investigation:", err);
      // Still allow navigation to split view — start a client-side timer as fallback
      openedAtRef.current = Date.now();
      setChallengeStarted(true);
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - openedAtRef.current) / 1000));
      }, 1000);
      setViewMode("split");
    }
  }

  const openGraphNewTab = useCallback(() => {
    const url = `${window.location.origin}/investigate/${challengeId}?mode=fullscreen`;
    window.open(url, "_blank");
  }, [challengeId]);

  // Check URL param for fullscreen mode on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "fullscreen") setViewMode("fullscreen");
  }, []);

  /* ─── Loading / Error ─────────────────────────────────────────── */
  if (loading) return (
    <div className="inv-page-loading">
      <div className="inv-loading-spinner" />
      <span>Loading investigation...</span>
    </div>
  );
  if (error) return (
    <div className="inv-page-error">
      <span>{error}</span>
      <button onClick={() => navigate("/challenges")}>Back to Challenges</button>
    </div>
  );

  const diff = DIFF_CONFIG[challenge.difficulty] || DIFF_CONFIG.easy;

  /* ================================================================
   *  VIEW: BRIEFING — full-screen challenge description
   * ============================================================== */
  if (viewMode === "briefing") {
    return (
      <div className="inv-page inv-page--briefing">
        {/* Top bar */}
        <div className="inv-topbar">
          <button className="inv-topbar-back" onClick={() => navigate("/challenges")}>
            ← Back
          </button>
          <div className="inv-topbar-title">
            <span className="inv-topbar-badge" style={{ color: diff.color, borderColor: diff.color }}>
              {diff.label}
            </span>
            <span className="inv-topbar-badge inv-topbar-badge--type">Investigation</span>
            <h1 className="inv-topbar-name">{challenge.title}</h1>
          </div>
          <div className="inv-topbar-right">
            <button className="inv-topbar-start-btn" onClick={handleStartInvestigation}>
              🔍 Start Investigating
            </button>
          </div>
        </div>

        {/* Full-screen briefing content */}
        <div className="inv-briefing-body">
          <div className="inv-briefing-card">
            {/* Mission Brief */}
            <section className="inv-briefing-section">
              <h2 className="inv-briefing-heading">
                <span className="inv-briefing-heading-icon">📋</span>
                Mission Brief
              </h2>
              <p className="inv-briefing-desc">{challenge.description}</p>
            </section>

            {/* Media attachment */}
            {challenge.mediaURL && (
              <section className="inv-briefing-section">
                <h2 className="inv-briefing-heading">
                  <span className="inv-briefing-heading-icon">📎</span>
                  Attached File
                </h2>
                <div className="inv-media-wrap">
                  {challenge.mediaType === "image" && (
                    <img
                      src={challenge.mediaURL}
                      alt="Challenge media"
                      className="inv-media-image"
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  )}
                  {challenge.mediaType === "video" && (
                    <video controls className="inv-media-video">
                      <source src={challenge.mediaURL} />
                    </video>
                  )}
                  {challenge.mediaType === "audio" && (
                    <audio controls className="inv-media-audio">
                      <source src={challenge.mediaURL} />
                    </audio>
                  )}
                  {(challenge.mediaType === "file" || (!["image","video","audio"].includes(challenge.mediaType) && challenge.mediaType !== "none")) && (
                    <div className="inv-media-file-info">
                      <span>📎</span>
                      <span>{challenge.mediaFilename || "attached-file"}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="inv-media-download-btn"
                    onClick={() => downloadInvMedia(challenge.mediaURL, challenge.mediaFilename)}
                  >
                    ↓ Download Original (metadata preserved)
                  </button>
                </div>
              </section>
            )}

            {/* Objectives */}
            {challenge.objectives?.length > 0 && (
              <section className="inv-briefing-section">
                <h2 className="inv-briefing-heading">
                  <span className="inv-briefing-heading-icon">🎯</span>
                  Objectives
                </h2>
                <ul className="inv-briefing-objectives">
                  {challenge.objectives.map((obj, i) => (
                    <li key={i} className="inv-briefing-obj-item">
                      <span className="inv-briefing-obj-num">{i + 1}</span>
                      <span>{obj}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Seed Node */}
            <section className="inv-briefing-section">
              <h2 className="inv-briefing-heading">
                <span className="inv-briefing-heading-icon">🌱</span>
                Seed Node
              </h2>
              <div className="inv-briefing-seed">
                <span className="inv-briefing-seed-label">Starting point:</span>
                <span className="inv-briefing-seed-value">{challenge.seedNode?.value}</span>
              </div>
            </section>

            {/* Hints */}
            {challenge.hints?.length > 0 && (
              <section className="inv-briefing-section">
                <h2 className="inv-briefing-heading">
                  <span className="inv-briefing-heading-icon">💡</span>
                  Hints
                </h2>
                <ul className="inv-briefing-hints">
                  {challenge.hints.map((hint, i) => (
                    <li key={i} className="inv-briefing-hint-item">{hint}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* How to Solve */}
            <section className="inv-briefing-section">
              <h2 className="inv-briefing-heading">
                <span className="inv-briefing-heading-icon">🧩</span>
                How to Solve
              </h2>
              <div className="inv-briefing-steps">
                {[
                  "Drag node types from the palette onto the canvas",
                  "Double-click a node to enter its value",
                  "Drag from a node's edge handle to connect it",
                  "Select the relationship type — correct links earn ELO",
                  "Right-click a node to delete it if needed",
                ].map((step, i) => (
                  <div key={i} className="inv-briefing-step">
                    <span className="inv-briefing-step-num">{i + 1}</span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* ── Flag Submission ──────────────────────────────── */}
            <section className="inv-briefing-section">
              <h2 className="inv-briefing-heading">
                <span className="inv-briefing-heading-icon">🚩</span>
                Submit Flag
              </h2>
              {flagResult?.correct ? (
                <div className="inv-flag-success">
                  <span className="inv-flag-success-icon">✓</span>
                  <div>
                    <div className="inv-flag-success-title">{flagResult?.alreadySolved ? "Already Solved" : "Correct!"}</div>
                    {!flagResult?.alreadySolved && <div className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</div>}
                    {flagResult?.alreadySolved && <div className="inv-flag-success-elo" style={{ color: "var(--color-text-muted)" }}>Flag submission disabled</div>}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleFlagSubmit} className="inv-flag-form">
                  {flagResult?.correct === false && (
                    <div className="inv-flag-wrong">
                      <span>✗</span>
                      <span>Incorrect answer</span>
                      {flagResult.eloChange && <span className="inv-flag-wrong-elo">{flagResult.eloChange} ELO</span>}
                    </div>
                  )}
                  {flagError && (
                    <div className="inv-flag-error">⚠ {flagError}</div>
                  )}
                  <div className="inv-flag-input-row">
                    <input
                      type="text"
                      className="inv-flag-input"
                      placeholder={flagFormat ? `Format: ${flagFormat}` : "Enter your flag answer..."}
                      value={flagAnswer}
                      onChange={e => setFlagAnswer(e.target.value)}
                      disabled={flagSubmitting || rateLimitSecs > 0}
                      autoComplete="off"
                    />
                    <button
                      type="submit"
                      className="inv-flag-submit-btn"
                      disabled={!flagAnswer.trim() || flagSubmitting || rateLimitSecs > 0}
                    >
                      {flagSubmitting ? "Verifying..." : rateLimitSecs > 0 ? `Wait ${rateLimitSecs}s` : "Submit →"}
                    </button>
                  </div>
                  {flagFormat && (
                    <div className="inv-flag-format-hint">
                      <span className="inv-flag-format-label">Flag format:</span>
                      <code className="inv-flag-format-code">{flagFormat}</code>
                    </div>
                  )}
                </form>
              )}
            </section>

            {/* CTA */}
            <button className="inv-briefing-cta" onClick={handleStartInvestigation}>
              🔍 Start Investigating →
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================
   *  VIEW: SPLIT / FULLSCREEN — graph canvas
   * ============================================================== */
  return (
    <div className={`inv-page inv-page--${viewMode}`}>
      {/* Top bar */}
      <div className="inv-topbar">
        <button className="inv-topbar-back" onClick={() => navigate("/challenges")}>
          ← Back
        </button>
        <div className="inv-topbar-title">
          <span className="inv-topbar-badge" style={{ color: diff.color, borderColor: diff.color }}>
            {diff.label}
          </span>
          <span className="inv-topbar-badge inv-topbar-badge--type">Investigation</span>
          <h1 className="inv-topbar-name">{challenge.title}</h1>
        </div>
        <div className="inv-topbar-right">
          {/* Timer */}
          {challengeStarted && !flagResult?.correct && (
            <div className="inv-topbar-timer" title="Time elapsed">
              <span className="inv-topbar-timer-icon">⏱</span>
              <span className="inv-topbar-timer-value">{formatInvTime(elapsedSeconds)}</span>
            </div>
          )}

          {eloTotal > 0 && <div className="inv-topbar-elo">+{eloTotal} ELO</div>}

          {/* Toggle sidebar */}
          <button
            className={`inv-topbar-panel-btn ${viewMode === "split" ? "active" : ""}`}
            onClick={() => setViewMode(v => v === "split" ? "fullscreen" : "split")}
            title={viewMode === "split" ? "Hide brief panel" : "Show brief panel"}
          >
            {viewMode === "split" ? "⬅ Hide Brief" : "➡ Show Brief"}
          </button>

          {/* Full-screen graph toggle */}
          <button
            className={`inv-topbar-panel-btn ${viewMode === "fullscreen" ? "active" : ""}`}
            onClick={() => setViewMode(v => v === "fullscreen" ? "split" : "fullscreen")}
            title="Toggle full-screen graph"
          >
            {viewMode === "fullscreen" ? "⊡ Exit Fullscreen" : "⊞ Fullscreen Graph"}
          </button>

          {/* Open in new tab */}
          <button className="inv-topbar-panel-btn" onClick={openGraphNewTab} title="Open graph in new tab">
            ↗ New Tab
          </button>

          {/* Back to briefing */}
          <button className="inv-topbar-panel-btn" onClick={() => setViewMode("briefing")} title="Back to briefing">
            📋 Brief
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="inv-main">
        {/* Sidebar — only in split mode */}
        {viewMode === "split" && (
          <div className="inv-sidebar">
            <div className="inv-sidebar-scroll">
              <div className="inv-sidebar-section">
                <div className="inv-sidebar-label">MISSION BRIEF</div>
                <p className="inv-sidebar-body">{challenge.description}</p>
              </div>

              {/* Media in sidebar */}
              {challenge.mediaURL && (
                <div className="inv-sidebar-section">
                  <div className="inv-sidebar-label">📎 ATTACHED FILE</div>
                  <div className="inv-sidebar-media">
                    {challenge.mediaType === "image" && (
                      <img
                        src={challenge.mediaURL}
                        alt="Challenge media"
                        className="inv-sidebar-media-img"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    {challenge.mediaType === "video" && (
                      <video controls className="inv-sidebar-media-video">
                        <source src={challenge.mediaURL} />
                      </video>
                    )}
                    {challenge.mediaType === "audio" && (
                      <audio controls style={{ width: '100%' }}>
                        <source src={challenge.mediaURL} />
                      </audio>
                    )}
                    <button
                      type="button"
                      className="inv-sidebar-download-btn"
                      onClick={() => downloadInvMedia(challenge.mediaURL, challenge.mediaFilename)}
                    >
                      ↓ Download Original
                    </button>
                  </div>
                </div>
              )}

              {challenge.objectives?.length > 0 && (
                <div className="inv-sidebar-section">
                  <div className="inv-sidebar-label">OBJECTIVES</div>
                  <ul className="inv-sidebar-objectives">
                    {challenge.objectives.map((obj, i) => (
                      <li key={i} className="inv-sidebar-obj">
                        <span className="inv-sidebar-obj-num">{i + 1}</span>
                        <span>{obj}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="inv-sidebar-section">
                <div className="inv-sidebar-label">SEED NODE</div>
                <div className="inv-sidebar-seed">
                  <span className="inv-sidebar-seed-label">Starting point:</span>
                  <span className="inv-sidebar-seed-value">{challenge.seedNode?.value}</span>
                </div>
              </div>

              {challenge.hints?.length > 0 && (
                <div className="inv-sidebar-section">
                  <div className="inv-sidebar-label">HINTS</div>
                  <ul className="inv-sidebar-hints">
                    {challenge.hints.map((hint, i) => (
                      <li key={i} className="inv-sidebar-hint">{hint}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="inv-sidebar-section">
                <div className="inv-sidebar-label">HOW TO SOLVE</div>
                <div className="inv-sidebar-steps">
                  {[
                    "Drag node types from the palette onto the canvas",
                    "Double-click a node to enter its value",
                    "Drag from a node's handle to connect",
                    "Select the relationship type",
                    "Right-click a node to delete it",
                  ].map((step, i) => (
                    <div key={i} className="inv-sidebar-step">
                      <span className="inv-sidebar-step-num">{i + 1}</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Flag Submission in sidebar ────────────────── */}
              <div className="inv-sidebar-section inv-sidebar-flag">
                <div className="inv-sidebar-label">🚩 SUBMIT FLAG</div>
                {flagResult?.correct ? (
                  <div className="inv-flag-success inv-flag-success--sm">
                    <span className="inv-flag-success-icon">✓</span>
                    <div>
                      <div className="inv-flag-success-title">{flagResult?.alreadySolved ? "Already Solved" : "Correct!"}</div>
                      {!flagResult?.alreadySolved && <div className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</div>}
                      {flagResult?.alreadySolved && <div className="inv-flag-success-elo" style={{ color: "var(--color-text-muted)" }}>Flag submission disabled</div>}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleFlagSubmit} className="inv-flag-form inv-flag-form--sm">
                    {flagResult?.correct === false && (
                      <div className="inv-flag-wrong"><span>✗</span> Incorrect</div>
                    )}
                    {flagError && <div className="inv-flag-error">⚠ {flagError}</div>}
                    <input
                      type="text"
                      className="inv-flag-input"
                      placeholder="Enter flag..."
                      value={flagAnswer}
                      onChange={e => setFlagAnswer(e.target.value)}
                      disabled={flagSubmitting || rateLimitSecs > 0}
                      autoComplete="off"
                    />
                    <button
                      type="submit"
                      className="inv-flag-submit-btn inv-flag-submit-btn--full"
                      disabled={!flagAnswer.trim() || flagSubmitting || rateLimitSecs > 0}
                    >
                      {flagSubmitting ? "Verifying..." : rateLimitSecs > 0 ? `Wait ${rateLimitSecs}s` : "Submit Flag →"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Graph board */}
        <div className="inv-board-container">
          <InvestigationBoard
            challenge={challenge}
            onEloUpdate={delta => setEloTotal(t => t + delta)}
          />

          {/* Floating flag submission bar (visible in fullscreen mode) */}
          {viewMode === "fullscreen" && (
            <div className="inv-floating-flag">
              {flagResult?.correct ? (
                <div className="inv-flag-success inv-flag-success--sm">
                  <span className="inv-flag-success-icon">✓</span>
                  <span className="inv-flag-success-title">{flagResult?.alreadySolved ? "Already Solved" : "Solved!"}</span>
                  {!flagResult?.alreadySolved && <span className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</span>}
                </div>
              ) : (
                <form onSubmit={handleFlagSubmit} className="inv-floating-flag-form">
                  {flagResult?.correct === false && (
                    <span className="inv-flag-wrong-inline">✗ Wrong</span>
                  )}
                  <input
                    type="text"
                    className="inv-flag-input inv-flag-input--float"
                    placeholder="Enter flag answer..."
                    value={flagAnswer}
                    onChange={e => setFlagAnswer(e.target.value)}
                    disabled={flagSubmitting || rateLimitSecs > 0}
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="inv-flag-submit-btn"
                    disabled={!flagAnswer.trim() || flagSubmitting || rateLimitSecs > 0}
                  >
                    {flagSubmitting ? "..." : rateLimitSecs > 0 ? `${rateLimitSecs}s` : "Submit"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatInvTime(seconds) {
  if (!seconds && seconds !== 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Download a file from a cross-origin URL (e.g. Cloudinary) as a blob
 * so the browser triggers a real download with the original filename.
 */
function downloadInvMedia(url, filename) {
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