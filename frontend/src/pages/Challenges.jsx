/**
 * Challenges.jsx
 * Challenge list page with filtering, search, and solved status.
 *
 * File location: frontend/src/pages/Challenges.jsx
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection, query, where, orderBy,
  limit, startAfter, getDocs, getDoc, doc
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import PageWrapper from "../components/layout/PageWrapper";
import "./Challenges.css";

const PAGE_SIZE = 20;

const DIFFICULTIES = ["all", "easy", "medium", "hard"];
const SORT_OPTIONS = [
  { value: "newest",    label: "Newest" },
  { value: "popular",   label: "Most Solved" },
  { value: "hardest",   label: "Hardest First" },
  { value: "easiest",   label: "Easiest First" },
];

const DIFF_CONFIG = {
  easy:   { label: "Easy",   color: "var(--color-easy)",   bg: "rgba(0,255,136,0.08)" },
  medium: { label: "Medium", color: "var(--color-medium)", bg: "rgba(255,149,0,0.08)" },
  hard:   { label: "Hard",   color: "var(--color-hard)",   bg: "rgba(255,77,77,0.08)" },
};

/**
 * Determines whether a challenge is locked for a free user.
 *
 * Rules:
 *  - Easy:           always free
 *  - Medium:         always free
 *  - Hard:           locked UNLESS challenge.weeklyFreeId matches the current
 *                    week's free hard challenge (set by a weekly Cloud Function)
 *  - Pro users:      nothing is locked
 */
function isChallengeLocked(challenge, isPro, weeklyFreeHardId) {
  if (isPro) return false;
  if (challenge.difficulty === "easy") return false;
  if (challenge.difficulty === "medium") return false;
  if (challenge.difficulty === "hard") return challenge.id !== weeklyFreeHardId;
  return false;
}

export default function Challenges() {
  const { currentUser, canSolveToday, isPro, dailySolvesRemaining } = useAuth();
  const navigate = useNavigate();

  const [challenges, setChallenges]     = useState([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(true);
  const [lastDoc, setLastDoc]           = useState(null);

  const [search, setSearch]             = useState("");
  const [difficulty, setDifficulty]     = useState("all");
  const [sortBy, setSortBy]             = useState("newest");

  const [solvedIds, setSolvedIds]       = useState(new Set());
  const [solvedLoading, setSolvedLoading] = useState(true);

  // Weekly free hard challenge ID (set by a scheduled Cloud Function each Monday)
  const [weeklyFreeHardId, setWeeklyFreeHardId] = useState(null);

  // Load weekly free hard challenge
  useEffect(() => {
    async function loadWeeklyFree() {
      try {
        const snap = await getDoc(doc(db, "config", "weeklyFreeChallenge"));
        if (snap.exists()) setWeeklyFreeHardId(snap.data().challengeId || null);
      } catch { /* ignore non-critical errors */ }
    }
    loadWeeklyFree();
  }, []);

  // Load user's solved challenges
  useEffect(() => {
    if (!currentUser) return;
    loadSolvedIds();
  }, [currentUser]);

  async function loadSolvedIds() {
    setSolvedLoading(true);
    try {
      const q = query(
        collection(db, "submissions"),
        where("userId", "==", currentUser.uid),
        where("isCorrect", "==", true)
      );
      const snap = await getDocs(q);
      const ids = new Set(snap.docs.map(d => d.data().challengeId));
      setSolvedIds(ids);
    } catch { /* ignore non-critical errors */ }
    setSolvedLoading(false);
  }

  // Load challenges when filters change
  useEffect(() => {
    setChallenges([]);
    setLastDoc(null);
    setHasMore(true);
    loadChallenges(true);
  }, [difficulty, sortBy]);

  async function loadChallenges(fresh = false) {
    if (fresh) setLoading(true);
    else setLoadingMore(true);

    try {
      let q = query(
        collection(db, "challenges"),
        where("isActive", "==", true),
        where("isDeleted", "==", false)
      );

      // Difficulty filter
      if (difficulty !== "all") {
        q = query(q, where("difficulty", "==", difficulty));
      }

      // Sort
      switch (sortBy) {
        case "popular":
          q = query(q, orderBy("solveCount", "desc"));
          break;
        case "hardest":
          q = query(q, where("difficulty", "==", "hard"), orderBy("solveCount", "asc"));
          break;
        case "easiest":
          q = query(q, where("difficulty", "==", "easy"), orderBy("solveCount", "desc"));
          break;
        default:
          q = query(q, orderBy("createdAt", "desc"));
      }

      q = query(q, limit(PAGE_SIZE));
      if (!fresh && lastDoc) q = query(q, startAfter(lastDoc));

      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      setChallenges(prev => fresh ? items : [...prev, ...items]);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      console.error("loadChallenges:", err);

      // Fallback: avoid index-sensitive sorting queries and recover with
      // client-side filtering/sorting so challenges still appear.
      try {
        const baseSnap = await getDocs(query(
          collection(db, "challenges"),
          where("isActive", "==", true),
          where("isDeleted", "==", false)
        ));

        let items = baseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (difficulty !== "all") {
          items = items.filter((c) => c.difficulty === difficulty);
        }

        switch (sortBy) {
          case "popular":
            items.sort((a, b) => (b.solveCount || 0) - (a.solveCount || 0));
            break;
          case "hardest":
            items = items.filter((c) => c.difficulty === "hard");
            items.sort((a, b) => (a.solveCount || 0) - (b.solveCount || 0));
            break;
          case "easiest":
            items = items.filter((c) => c.difficulty === "easy");
            items.sort((a, b) => (b.solveCount || 0) - (a.solveCount || 0));
            break;
          default:
            items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        }

        setChallenges(items);
        setLastDoc(null);
        setHasMore(false);
      } catch (fallbackErr) {
        console.error("loadChallenges fallback:", fallbackErr);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // Client-side search filter
  const filteredChallenges = challenges.filter(c =>
    search.trim() === "" ||
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const totalSolved = solvedIds.size;

  return (
    <PageWrapper>
      <div className="challenges-page">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="challenges-header">
          <div>
            <h1 className="challenges-title">Challenges</h1>
            <p className="challenges-subtitle">
              {solvedLoading ? "..." : `${totalSolved} solved`}
              {!isPro && (
                <span className="challenges-limit-note">
                  {" · Hard challenges require Pro · "}
                  <Link to="/pricing" className="challenges-upgrade-link">
                    Upgrade →
                  </Link>
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="challenges-filters">
          {/* Search */}
          <div className="challenges-search-wrap">
            <span className="challenges-search-icon">⌕</span>
            <input
              type="text"
              className="challenges-search"
              placeholder="Search challenges..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="challenges-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >×</button>
            )}
          </div>

          {/* Difficulty tabs */}
          <div className="challenges-diff-tabs">
            {DIFFICULTIES.map(d => (
              <button
                key={d}
                className={`challenges-diff-tab ${difficulty === d ? "challenges-diff-tab--active" : ""}`}
                onClick={() => setDifficulty(d)}
                style={difficulty === d && d !== "all" ? {
                  color: DIFF_CONFIG[d]?.color,
                  borderColor: DIFF_CONFIG[d]?.color,
                  background: DIFF_CONFIG[d]?.bg,
                } : {}}
              >
                {d === "all" ? "All" : DIFF_CONFIG[d].label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            className="challenges-sort"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* ── Stats bar ───────────────────────────────────────────────── */}
        <div className="challenges-stats-bar">
          {["easy", "medium", "hard"].map(d => (
            <div key={d} className="challenges-stats-item">
              <span
                className="challenges-stats-dot"
                style={{ background: DIFF_CONFIG[d].color }}
              />
              <span className="challenges-stats-label">{DIFF_CONFIG[d].label}</span>
              <span className="challenges-stats-count" style={{ color: DIFF_CONFIG[d].color }}>
                {solvedIds
                  ? challenges.filter(c => c.difficulty === d && solvedIds.has(c.id)).length
                  : 0
                }
                <span className="challenges-stats-total">
                  /{challenges.filter(c => c.difficulty === d).length}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* ── Card Grid ──────────────────────────────────────────────── */}
        {loading ? (
          <div className="challenges-skeleton">
            {[...Array(9)].map((_, i) => (
              <div key={i} className="challenges-skeleton-row" />
            ))}
          </div>
        ) : filteredChallenges.length === 0 ? (
          <div className="challenges-empty">
            <span className="challenges-empty-icon">◈</span>
            <p>No challenges found.</p>
            {search && <button className="challenges-empty-clear" onClick={() => setSearch("")}>Clear search</button>}
          </div>
        ) : (
          <>
            <div className="challenges-grid">
              {filteredChallenges.map((challenge, idx) => {
                const solved  = solvedIds.has(challenge.id);
                const locked  = isChallengeLocked(challenge, isPro, weeklyFreeHardId);
                const isWeeklyFree = challenge.id === weeklyFreeHardId;
                const diff    = challenge.difficulty || "easy";

                return (
                  <div key={challenge.id}
                    className={["challenge-card", `challenge-card--${diff}`,
                      solved ? "challenge-card--solved" : "",
                      locked ? "challenge-card--locked" : ""].filter(Boolean).join(" ")}
                    style={{ "--card-i": idx }}
                    onClick={() => locked
                      ? navigate("/pricing", { state: { reason: "pro_required" } })
                      : navigate(`/challenges/${challenge.slug}`)
                    }
                  >
                    {/* Top row: status + chips */}
                    <div className="challenge-card-top">
                      <div className="challenge-card-chips">
                        <span className={`ch-diff-chip ch-diff-chip--${diff}`}>{diff}</span>
                        {challenge.type === "investigation" && <span className="ch-invest-badge">🔍 Investigation</span>}
                        {isWeeklyFree && <span className="ch-free-badge">FREE WEEK</span>}
                        {locked && <span className="ch-pro-badge">PRO</span>}
                        {solved && <span className="ch-solved-badge">✓ Solved</span>}
                      </div>
                      <div className={`ch-status-icon ${locked ? "ch-status-icon--locked" : solved ? "ch-status-icon--solved" : "ch-status-icon--unsolved"}`}>
                        {locked ? "⚿" : solved ? "✓" : ""}
                      </div>
                    </div>

                    {/* Title */}
                    <div className={`challenge-card-title ${locked ? "challenge-card-title--blur" : ""}`}>
                      {challenge.title}
                    </div>

                    {/* Tags */}
                    {challenge.tags?.length > 0 && (
                      <div className="challenge-card-tags">
                        {challenge.tags.slice(0, 4).map(t => (
                          <span key={t} className="ch-tag">{t}</span>
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="challenge-card-footer">
                      <span className="ch-pts">+{challenge.basePoints} pts</span>
                      <span className="ch-solvers">{(challenge.solveCount || 0).toLocaleString()} solvers</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {hasMore && (
              <div className="challenges-load-more">
                <button className="challenges-load-more-btn"
                  onClick={() => loadChallenges(false)} disabled={loadingMore}>
                  {loadingMore ? "Loading..." : "Load more challenges"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PageWrapper>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s > 0 ? s + "s" : ""}`.trim() : `${s}s`;
}