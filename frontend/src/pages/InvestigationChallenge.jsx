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

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
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
  const { canSolveToday } = useAuth();

  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [eloTotal, setEloTotal]   = useState(0);

  // "briefing" | "split" | "fullscreen"
  const [viewMode, setViewMode] = useState("briefing");

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

        openChallengeFn({ challengeId }).catch(err => {
          console.warn("openChallenge unavailable:", err.message);
          // Don't block the page — challenge data loaded from Firestore directly
        });
      } catch (err) {
        console.error(err);
        setError("Failed to load challenge.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [challengeId, navigate]);

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
            <button className="inv-topbar-start-btn" onClick={() => setViewMode("split")}>
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
                    <div className="inv-flag-success-title">Correct!</div>
                    <div className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</div>
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
                      placeholder="Enter your flag answer..."
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
                </form>
              )}
            </section>

            {/* CTA */}
            <button className="inv-briefing-cta" onClick={() => setViewMode("split")}>
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
                      <div className="inv-flag-success-title">Correct!</div>
                      <div className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</div>
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
                  <span className="inv-flag-success-title">Solved!</span>
                  <span className="inv-flag-success-elo">+{flagResult.eloChange || 0} ELO</span>
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