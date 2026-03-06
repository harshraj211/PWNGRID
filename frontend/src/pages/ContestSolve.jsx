/**
 * ContestSolve.jsx
 * Live contest interface.
 * Two panels: LEFT = challenge list + active challenge description
 *             RIGHT = answer input + live scoreboard
 *
 * Route: /contests/:contestId
 * Works for: live contests (solve mode) + past contests (results mode)
 *
 * File location: frontend/src/pages/ContestSolve.jsx
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc, getDoc, collection, query,
  orderBy, limit, onSnapshot, getDocs
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import Navbar from "../components/layout/Navbar";
import RaceChart from "../components/contest/RaceChart";
import "./ContestSolve.css";

const functions         = getFunctions();
const submitContestFn   = httpsCallable(functions, "submitContestAnswer");

const DIFF_CONFIG = {
  easy:   { color: "var(--color-easy)"   },
  medium: { color: "var(--color-medium)" },
  hard:   { color: "var(--color-hard)"   },
};

export default function ContestSolve() {
  const { contestId } = useParams();
  const navigate      = useNavigate();
  const { currentUser } = useAuth();

  // Contest meta
  const [contest, setContest]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");

  // Participation state
  const [participant, setParticipant] = useState(null);
  const [notRegistered, setNotRegistered] = useState(false);

  // Challenges
  const [challenges, setChallenges]   = useState([]);
  const [solvedIds, setSolvedIds]     = useState(new Set());
  const [activeChallenge, setActiveChallenge] = useState(null);
  const [hintUsed, setHintUsed]       = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  // Answer
  const [answer, setAnswer]           = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [rateLimit, setRateLimit]     = useState(0);

  // Scoreboard
  const [scoreboard, setScoreboard]   = useState([]);
  const [sbTab, setSbTab]             = useState("scoreboard"); // scoreboard | race | mysolves
  const [sbLimit, setSbLimit]         = useState(25);
  const [sbHasMore, setSbHasMore]     = useState(false);

  // Timer
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [contestEnded, setContestEnded]   = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    loadContest();
    return () => clearInterval(timerRef.current);
  }, [contestId]);

  // Live scoreboard subscription
  useEffect(() => {
    if (!contestId) return;
    const unsub = onSnapshot(
      query(
        collection(db, "contests", contestId, "participants"),
        orderBy("score", "desc"),
        limit(sbLimit + 1) // fetch one extra to detect "has more"
      ),
      (snap) => {
        const docs = snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data() }));
        if (docs.length > sbLimit) {
          setSbHasMore(true);
          setScoreboard(docs.slice(0, sbLimit));
        } else {
          setSbHasMore(false);
          setScoreboard(docs);
        }
      }
    );
    return unsub;
  }, [contestId, sbLimit]);

  // Rate limit countdown
  useEffect(() => {
    if (rateLimit <= 0) return;
    const t = setInterval(() => setRateLimit(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [rateLimit]);

  async function loadContest() {
    setLoading(true);
    try {
      const contestSnap = await getDoc(doc(db, "contests", contestId));
      if (!contestSnap.exists()) { setError("Contest not found."); setLoading(false); return; }
      const contestData = { id: contestSnap.id, ...contestSnap.data() };
      setContest(contestData);

      // Check registration
      if (currentUser) {
        const partSnap = await getDoc(
          doc(db, "contests", contestId, "participants", currentUser.uid)
        );
        if (!partSnap.exists()) {
          setNotRegistered(true);
        } else {
          setParticipant(partSnap.data());
        }
      }

      // Load challenges
      const challengeDocs = await Promise.all(
        (contestData.challengeIds || []).map(id =>
          getDoc(doc(db, "challenges", id))
        )
      );
      const cList = challengeDocs
        .filter(d => d.exists())
        .map(d => ({ id: d.id, ...d.data() }));
      setChallenges(cList);
      if (cList.length > 0) setActiveChallenge(cList[0]);

      // Load already-solved challenges in this contest
      if (currentUser) {
        const attemptsSnap = await getDocs(
          collection(db, "contests", contestId, "participants", currentUser.uid, "attempts")
        );
        const solved = new Set(
          attemptsSnap.docs.filter(d => d.data().solved).map(d => d.id)
        );
        setSolvedIds(solved);
      }

      // Start timer
      const endMs = contestData.endTime?.toMillis?.() ?? 0;
      startTimer(endMs);

    } catch (err) {
      setError(err.message || "Failed to load contest.");
    } finally {
      setLoading(false);
    }
  }

  function startTimer(endMs) {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, endMs - Date.now());
      setTimeRemaining(remaining);
      if (remaining === 0) {
        clearInterval(timerRef.current);
        // Auto-submit: disable further input when contest ends
        setContestEnded(true);
      }
    }, 1000);
    setTimeRemaining(Math.max(0, endMs - Date.now()));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!answer.trim() || submitting || rateLimit > 0 || !activeChallenge) return;

    setSubmitting(true);
    setSubmitError("");
    setSubmitResult(null);

    try {
      const res = await submitContestFn({
        contestId,
        challengeId: activeChallenge.id,
        answer:      answer.trim(),
        hintUsed,
      });
      const data = res.data;
      setSubmitResult(data);

      if (data.correct) {
        setSolvedIds(prev => new Set([...prev, activeChallenge.id]));
        setAnswer("");
        // Auto-advance to next unsolved challenge
        const nextUnsolved = challenges.find(
          c => c.id !== activeChallenge.id && !solvedIds.has(c.id)
        );
        if (nextUnsolved) {
          setTimeout(() => {
            setActiveChallenge(nextUnsolved);
            setSubmitResult(null);
            setHintUsed(false);
            setHintVisible(false);
          }, 2000);
        }
      } else {
        setAnswer("");
        if (data.penaltyAdded) {
          // Show penalty briefly
        }
      }
    } catch (err) {
      const match = err.message?.match(/Wait (\d+)s/);
      if (match) setRateLimit(parseInt(match[1]));
      setSubmitError(err.message || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function selectChallenge(c) {
    if (c.id === activeChallenge?.id) return;
    setActiveChallenge(c);
    setAnswer("");
    setSubmitResult(null);
    setSubmitError("");
    setHintUsed(false);
    setHintVisible(false);
  }

  function loadMoreScoreboard() {
    setSbLimit(prev => prev + 25);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <ContestLoading />;
  if (error)   return <ContestError error={error} onBack={() => navigate("/contests")} />;

  const now      = Date.now();
  const startMs  = contest?.startTime?.toMillis?.() ?? 0;
  const endMs    = contest?.endTime?.toMillis?.()   ?? 0;
  const isLive   = now >= startMs && now < endMs;
  const isPast   = now >= endMs;
  const myEntry  = scoreboard.find(e => e.id === currentUser?.uid);
  const myRank   = myEntry?.rank;
  const myScore  = myEntry?.score ?? participant?.score ?? 0;
  const myPenalty = myEntry?.penalties ?? participant?.penalties ?? 0;

  return (
    <div className="cs-shell">
      <Navbar />

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="cs-topbar">
        <button className="cs-back-btn" onClick={() => navigate("/contests")}>
          ← Contests
        </button>

        <div className="cs-topbar-center">
          <h1 className="cs-title">{contest?.title}</h1>
          {isLive && <span className="cs-live-chip">LIVE</span>}
          {isPast && <span className="cs-ended-chip">ENDED</span>}
        </div>

        <div className="cs-topbar-right">
          {/* Timer */}
          {isLive && (
            <div className={`cs-timer ${timeRemaining < 300000 ? "cs-timer--warning" : ""}`}>
              <span className="cs-timer-icon">⏱</span>
              <span className="cs-timer-value">{formatMs(timeRemaining)}</span>
            </div>
          )}

          {/* My score */}
          {myEntry && (
            <div className="cs-myscore">
              <span className="cs-myscore-label">Score</span>
              <span className="cs-myscore-value">{myScore}</span>
            </div>
          )}

          {/* Solved count */}
          <div className="cs-solved-count">
            <span className="cs-solved-value">{solvedIds.size}</span>
            <span className="cs-solved-sep">/</span>
            <span className="cs-solved-total">{challenges.length}</span>
          </div>
        </div>
      </div>

      {/* ── Not registered banner ────────────────────────────────────── */}
      {notRegistered && (
        <div className="cs-not-registered">
          You're not registered for this contest.{" "}
          {!isPast && <Link to="/contests" className="cs-reg-link">Register →</Link>}
        </div>
      )}

      {/* ── Challenge tabs (horizontal) ─────────────────────────────── */}
      <div className="cs-challenge-tabs">
        {challenges.map((c) => {
          const solved  = solvedIds.has(c.id);
          const active  = activeChallenge?.id === c.id;
          const diff    = DIFF_CONFIG[c.difficulty] || {};
          return (
            <button
              key={c.id}
              className={`cs-challenge-tab ${active ? "cs-challenge-tab--active" : ""} ${solved ? "cs-challenge-tab--solved" : ""}`}
              onClick={() => selectChallenge(c)}
            >
              <span
                className="cs-challenge-dot"
                style={{ background: solved ? "var(--color-accent)" : diff.color || "var(--color-border)" }}
              />
              <span className="cs-challenge-tab-title">{c.title}</span>
              {solved && <span className="cs-challenge-check">✓</span>}
              <span className="cs-challenge-pts">+{c.basePoints}</span>
            </button>
          );
        })}
      </div>

      {/* ── Main split panels ────────────────────────────────────────── */}
      <div className="cs-panels">

        {/* LEFT: challenge description */}
        <div className="cs-panel cs-panel--left">
          {activeChallenge && (
            <div className="cs-description">
              <div className="cs-description-header">
                <h2 className="cs-description-title">{activeChallenge.title}</h2>
                <span
                  className="cs-description-diff"
                  style={{ color: DIFF_CONFIG[activeChallenge.difficulty]?.color }}
                >
                  {activeChallenge.difficulty}
                </span>
              </div>

              <div className="cs-markdown">
                <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{activeChallenge.description}</ReactMarkdown>
              </div>

              {/* Media attachment */}
              {activeChallenge.mediaURL && (
                <div className="cs-media-section">
                  <div className="cs-media-header">
                    <span className="cs-media-label">Attached File</span>
                    <button
                      type="button"
                      className="cs-media-download-btn"
                      onClick={() => downloadMedia(activeChallenge.mediaURL, activeChallenge.mediaFilename)}
                    >
                      ↓ Download
                    </button>
                  </div>
                  <div className="cs-media-wrap">
                    {activeChallenge.mediaType === "image" && (
                      <img
                        src={activeChallenge.mediaURL}
                        alt="Challenge media"
                        style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }}
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    )}
                    {activeChallenge.mediaType === "video" && (
                      <video controls style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }}>
                        <source src={activeChallenge.mediaURL} />
                      </video>
                    )}
                    {activeChallenge.mediaType === "audio" && (
                      <audio controls style={{ width: "100%", marginTop: 8 }}>
                        <source src={activeChallenge.mediaURL} />
                      </audio>
                    )}
                    {activeChallenge.mediaType && !["image","video","audio"].includes(activeChallenge.mediaType) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "8px 12px", background: "var(--color-bg-secondary)", borderRadius: 8, fontSize: 13 }}>
                        <span>📎</span>
                        <span style={{ color: "var(--color-text-muted)" }}>{activeChallenge.mediaFilename || "attached-file"}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Hint */}
              {activeChallenge.hint && isLive && !solvedIds.has(activeChallenge.id) && (
                <div className="cs-hint-section">
                  {hintVisible ? (
                    <div className="cs-hint-revealed">
                      <span>💡</span>
                      <p>{activeChallenge.hint}</p>
                    </div>
                  ) : (
                    <button
                      className="cs-hint-btn"
                      onClick={() => { setHintVisible(true); setHintUsed(true); }}
                    >
                      Reveal hint
                      <span className="cs-hint-penalty">−40% point penalty</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: answer + scoreboard */}
        <div className="cs-panel cs-panel--right">

          {/* Answer form */}
          {isLive && !contestEnded && !notRegistered && activeChallenge && !solvedIds.has(activeChallenge?.id) && (
            <form className="cs-answer-form" onSubmit={handleSubmit} noValidate>
              <div className="cs-form-header">
                <span className="cs-form-label">Submit Answer</span>
                <span className="cs-form-hint">Ctrl+Enter</span>
              </div>

              {submitResult?.correct === false && (
                <div className="cs-wrong-feedback">
                  <span className="cs-wrong-icon">✗</span>
                  <div>
                    <span className="cs-wrong-text">Incorrect</span>
                    <span className="cs-wrong-penalty">+{Math.round(submitResult.penaltyAdded / 60)}min penalty</span>
                  </div>
                </div>
              )}

              {submitError && (
                <div className="cs-submit-error"><span>⚠</span> {submitError}</div>
              )}

              <input
                type="text"
                className="cs-answer-input"
                placeholder={activeChallenge.flagFormat ? `Format: ${activeChallenge.flagFormat}` : "Enter your answer..."}
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                disabled={submitting || rateLimit > 0}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />

              {/* Flag format hint */}
              {activeChallenge.flagFormat && (
                <div className="cs-flag-format-hint">
                  <span className="cs-flag-format-label">Flag format:</span>
                  <code className="cs-flag-format-code">{activeChallenge.flagFormat}</code>
                </div>
              )}

              {rateLimit > 0 && (
                <div className="cs-ratelimit">⏳ Wait {rateLimit}s before retrying</div>
              )}

              <button
                type="submit"
                className="cs-submit-btn"
                disabled={!answer.trim() || submitting || rateLimit > 0}
              >
                {submitting ? "Verifying..." : rateLimit > 0 ? `Wait ${rateLimit}s` : "Submit →"}
              </button>
            </form>
          )}

          {/* Contest ended banner */}
          {contestEnded && (
            <div className="cs-not-registered" style={{ background: "rgba(255,149,0,0.08)", borderColor: "var(--color-medium)" }}>
              ⏱ Contest has ended. Your results have been auto-submitted. Rankings will be finalized shortly.
            </div>
          )}

          {/* Correct solve celebration */}
          {submitResult?.correct && (
            <div className="cs-correct-result">
              <span className="cs-correct-icon">✓</span>
              <div className="cs-correct-pts">+{submitResult.pointsEarned}</div>
              <div className="cs-correct-label">points earned</div>
              {submitResult.allSolved && (
                <div className="cs-all-solved">🎉 All challenges solved!</div>
              )}
            </div>
          )}

          {/* Solved badge on active challenge */}
          {activeChallenge && solvedIds.has(activeChallenge.id) && !submitResult?.correct && (
            <div className="cs-already-solved">
              <span>✓</span> Already solved — +{
                // find points from scoreboard attempt
                "points earned"
              }
            </div>
          )}

          {/* Scoreboard / my solves tabs */}
          <div className="cs-sb-card">
            <div className="cs-sb-tabs">
              <button
                className={`cs-sb-tab ${sbTab === "scoreboard" ? "cs-sb-tab--active" : ""}`}
                onClick={() => setSbTab("scoreboard")}
              >
                Scoreboard
              </button>
              <button
                className={`cs-sb-tab ${sbTab === "race" ? "cs-sb-tab--active" : ""}`}
                onClick={() => setSbTab("race")}
              >
                Race Chart
              </button>
              <button
                className={`cs-sb-tab ${sbTab === "mysolves" ? "cs-sb-tab--active" : ""}`}
                onClick={() => setSbTab("mysolves")}
              >
                My Solves
              </button>
            </div>

            {sbTab === "scoreboard" && (
              <div className="cs-scoreboard">
                {scoreboard.length === 0 ? (
                  <p className="cs-sb-empty">No participants yet.</p>
                ) : (
                  <>
                    {scoreboard.map((entry) => {
                      const isMe = entry.id === currentUser?.uid;
                      return (
                        <div key={entry.id} className={`cs-sb-row ${isMe ? "cs-sb-row--me" : ""}`}>
                          <span className="cs-sb-rank">
                            {entry.rank <= 3
                              ? ["🥇","🥈","🥉"][entry.rank - 1]
                              : `#${entry.rank}`
                            }
                          </span>
                          <span className="cs-sb-username">
                            {entry.username}
                            {isMe && <span className="cs-sb-you">you</span>}
                          </span>
                          <span className="cs-sb-solves">{entry.solveCount || 0} ✓</span>
                          <span className="cs-sb-score">{entry.score || 0}</span>
                        </div>
                      );
                    })}
                    {/* Pagination: load more */}
                    {sbHasMore && (
                      <button
                        className="cs-sb-load-more"
                        onClick={loadMoreScoreboard}
                        style={{
                          display: "block", width: "100%", padding: "8px", marginTop: 4,
                          background: "none", border: "1px solid var(--color-border)",
                          borderRadius: 6, color: "var(--color-text-muted)",
                          fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
                        }}
                      >
                        Load more participants...
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {sbTab === "race" && (
              <RaceChart
                contestId={contestId}
                startMs={startMs}
                endMs={endMs}
              />
            )}

            {sbTab === "mysolves" && (
              <div className="cs-my-solves">
                {challenges.length === 0 ? (
                  <p className="cs-sb-empty">No challenges.</p>
                ) : (
                  challenges.map(c => {
                    const solved = solvedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        className={`cs-my-solve-row ${solved ? "cs-my-solve-row--solved" : ""}`}
                        onClick={() => selectChallenge(c)}
                      >
                        <span className={`cs-my-solve-status ${solved ? "cs-my-solve-status--solved" : ""}`}>
                          {solved ? "✓" : "○"}
                        </span>
                        <span className="cs-my-solve-title">{c.title}</span>
                        <span className="cs-my-solve-pts" style={{ color: DIFF_CONFIG[c.difficulty]?.color }}>
                          +{c.basePoints}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Penalty counter */}
          {myPenalty > 0 && (
            <div className="cs-penalty-bar">
              <span className="cs-penalty-label">⚠ Penalty time</span>
              <span className="cs-penalty-value">+{formatSeconds(myPenalty)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ContestLoading() {
  return (
    <div className="cs-loading">
      <Navbar />
      <div className="cs-loading-body">
        <div className="cs-loading-spinner" />
        <span>Loading contest...</span>
      </div>
    </div>
  );
}

function ContestError({ error, onBack }) {
  return (
    <div className="cs-loading">
      <Navbar />
      <div className="cs-loading-body">
        <div style={{ fontSize: 32, color: "var(--color-error)" }}>⚠</div>
        <p style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}>{error}</p>
        <button
          style={{ background: "none", border: "1px solid var(--color-border-subtle)", borderRadius: 6, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.75rem", padding: "6px 14px", cursor: "pointer" }}
          onClick={onBack}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatMs(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatSeconds(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function pad(n) { return String(n).padStart(2, "0"); }

function downloadMedia(url, filename) {
  const name = filename || url.split("/").pop()?.split("?")[0] || "download";
  const isCloudinary = url.includes("cloudinary.com");
  const isRaw = url.includes("/raw/upload/");

  // fl_attachment only works on image/video, not raw uploads
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