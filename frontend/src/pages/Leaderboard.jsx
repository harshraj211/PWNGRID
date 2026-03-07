/**
 * Leaderboard.jsx
 * Three-tab leaderboard: Global ELO / Weekly / Monthly
 * Shows top 100 users per period with rank, username, ELO, tier.
 *
 * File location: frontend/src/pages/Leaderboard.jsx
 */

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import PageWrapper from "../components/layout/PageWrapper";
import "./Leaderboard.css";

const TABS = [
  { key: "global",  label: "Global ELO",   field: "elo" },
  { key: "weekly",  label: "This Week",     field: "weeklyElo" },
  { key: "monthly", label: "This Month",    field: "monthlyElo" },
];

const ELO_TIERS = [
  { name: "Recruit",  min: 0,    max: 199,    color: "#8B949E" },
  { name: "Analyst",  min: 200,  max: 499,    color: "#CD7F32" },
  { name: "Agent",    min: 500,  max: 999,    color: "#C0C0C0" },
  { name: "Operator", min: 1000, max: 1999,   color: "#FFD700" },
  { name: "Elite",    min: 2000, max: 3999,   color: "#00BFFF" },
  { name: "Phantom",  min: 4000, max: Infinity, color: "#00FF88" },
];

function getTier(elo) {
  return ELO_TIERS.find(t => elo >= t.min && elo <= t.max) || ELO_TIERS[0];
}

export default function Leaderboard() {
  const { currentUser, userProfile } = useAuth();

  const [activeTab, setActiveTab]   = useState("global");
  const [entries, setEntries]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [myRank, setMyRank]         = useState(null);

  // Cache per tab so switching tabs doesn't re-fetch
  const [cache, setCache] = useState({});

  useEffect(() => {
    if (cache[activeTab]) {
      setEntries(cache[activeTab]);
      setLoading(false);
    } else {
      loadLeaderboard(activeTab);
    }
  }, [activeTab]);

  async function loadLeaderboard(tab) {
    setLoading(true);
    const field = TABS.find(t => t.key === tab)?.field || "elo";

    try {
      const q = query(
        collection(db, "publicProfiles"),
        orderBy(field, "desc"),
        limit(100)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map((d, i) => ({
        id: d.id,
        rank: i + 1,
        ...d.data(),
      }));

      setEntries(data);
      setCache(prev => ({ ...prev, [tab]: data }));

      // Find current user's rank
      if (currentUser) {
        const myIdx = data.findIndex(e => e.id === currentUser.uid);
        setMyRank(myIdx >= 0 ? myIdx + 1 : null);
      }
    } catch (err) {
      console.error("loadLeaderboard:", err);
    } finally {
      setLoading(false);
    }
  }

  const currentField = TABS.find(t => t.key === activeTab)?.field || "elo";
  const myEntry      = entries.find(e => e.id === currentUser?.uid);

  return (
    <PageWrapper>
      <div className="lb-page">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="lb-header">
          <h1 className="lb-title">Leaderboard</h1>
          <p className="lb-subtitle">Top 100 analysts ranked by ELO</p>
        </div>

        {/* ── My rank card (if in top 100) ─────────────────────────────── */}
        {myEntry && (
          <div className="lb-my-rank">
            <span className="lb-my-rank-label">Your rank</span>
            <span className="lb-my-rank-num">#{myEntry.rank}</span>
            <span className="lb-my-rank-elo">
              {(myEntry[currentField] || 0).toLocaleString()} ELO
            </span>
            <span
              className="lb-my-rank-tier"
              style={{ color: getTier(myEntry[currentField] || 0).color }}
            >
              {getTier(myEntry[currentField] || 0).name}
            </span>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <div className="lb-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`lb-tab ${activeTab === tab.key ? "lb-tab--active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Table ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="lb-skeleton">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="lb-skeleton-row" style={{ animationDelay: `${i * 0.04}s` }} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="lb-empty">
            <span className="lb-empty-icon">◈</span>
            <p>No data yet for this period.</p>
          </div>
        ) : (
          <div className="lb-table">
            {/* Header */}
            <div className="lb-table-header">
              <span className="lb-col-rank">Rank</span>
              <span className="lb-col-user">Analyst</span>
              <span className="lb-col-tier">Tier</span>
              <span className="lb-col-elo">ELO</span>
              <span className="lb-col-solved">Solved</span>
            </div>

            {/* Rows */}
            {entries.map((entry) => {
              const elo     = entry[currentField] || 0;
              const tier    = getTier(elo);
              const isMe    = entry.id === currentUser?.uid;
              const isPodium = entry.rank <= 3;

              return (
                <div
                  key={entry.id}
                  className={[
                    "lb-row",
                    isMe        ? "lb-row--me"      : "",
                    isPodium    ? `lb-row--rank${entry.rank}` : "",
                  ].filter(Boolean).join(" ")}
                  style={{ animationDelay: `${(entry.rank - 1) * 0.02}s` }}
                >
                  {/* Rank */}
                  <span className="lb-col-rank">
                    {entry.rank <= 3 ? (
                      <span className="lb-medal">
                        {entry.rank === 1 ? "🥇" : entry.rank === 2 ? "🥈" : "🥉"}
                      </span>
                    ) : (
                      <span className="lb-rank-num">#{entry.rank}</span>
                    )}
                  </span>

                  {/* User */}
                  <span className="lb-col-user">
                    <div className="lb-user-avatar" style={{ background: tier.color }}>
                      {(entry.username || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="lb-user-info">
                      <Link
                        to={`/profile/${entry.username}`}
                        className={`lb-username ${isMe ? "lb-username--me" : ""}`}
                      >
                        {entry.username || "Anonymous"}
                        {isMe && <span className="lb-you-badge">You</span>}
                      </Link>
                      {entry.plan === "pro" && (
                        <span className="lb-pro-chip">PRO</span>
                      )}
                    </div>
                  </span>

                  {/* Tier */}
                  <span className="lb-col-tier">
                    <span
                      className="lb-tier-chip"
                      style={{ color: tier.color, background: `${tier.color}18` }}
                    >
                      {tier.name}
                    </span>
                  </span>

                  {/* ELO */}
                  <span className="lb-col-elo">
                    <span
                      className="lb-elo-value"
                      style={{ color: tier.color }}
                    >
                      {elo.toLocaleString()}
                    </span>
                  </span>

                  {/* Solved */}
                  <span className="lb-col-solved lb-muted">
                    {(entry.totalSolved || 0).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Not in top 100 note ──────────────────────────────────────── */}
        {!loading && !myEntry && currentUser && (
          <div className="lb-not-ranked">
            You&apos;re not in the top 100 yet — keep solving to climb the ranks!
          </div>
        )}

      </div>
    </PageWrapper>
  );
}