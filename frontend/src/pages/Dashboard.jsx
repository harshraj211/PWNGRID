/**
 * Dashboard.jsx — v2 Premium
 * Added: hero challenge block, count-up numbers, navbar glitch branding
 * File location: frontend/src/pages/Dashboard.jsx
 */
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  collection, query, where, orderBy, limit,
  getDocs, doc, getDoc
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import PageWrapper from "../components/layout/PageWrapper";
import SocialPanel from "../components/social/SocialPanel";
import "./Dashboard.css";

// ── Count-up hook ─────────────────────────────────────────────────────────────
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setValue(target); clearInterval(timer); }
      else setValue(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target]);
  return value;
}

export default function Dashboard() {
  const { currentUser, userProfile, isPro } = useAuth();

  const [recentActivity,  setRecentActivity]  = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [heatmapData,     setHeatmapData]     = useState({});
  const [todaySolves,     setTodaySolves]     = useState(0);
  const [weeklyChallenge, setWeeklyChallenge] = useState(null);

  useEffect(() => {
    if (!currentUser) return;
    loadRecentActivity();
    loadHeatmap();
    loadWeeklyChallenge();
  }, [currentUser]);

  async function loadRecentActivity() {
    setActivityLoading(true);
    try {
      const q = query(
        collection(db, "submissions"),
        where("userId", "==", currentUser.uid),
        orderBy("timestamp", "desc"),
        limit(8)
      );
      const snap = await getDocs(q);
      const items = [];
      for (const docSnap of snap.docs) {
        const sub = docSnap.data();
        let challengeTitle = sub.challengeId;
        let challengeSlug  = "";
        let difficulty     = "easy";
        try {
          const cSnap = await getDoc(doc(db, "challenges", sub.challengeId));
          if (cSnap.exists()) {
            challengeTitle = cSnap.data().title;
            challengeSlug  = cSnap.data().slug;
            difficulty     = cSnap.data().difficulty;
          }
        } catch { /* ignore non-critical errors */ }
        items.push({ id: docSnap.id, ...sub, challengeTitle, challengeSlug, difficulty });
      }
      setRecentActivity(items);
      const today = new Date().toISOString().split("T")[0];
      setTodaySolves(items.filter(i =>
        i.isCorrect && i.timestamp?.toDate().toISOString().split("T")[0] === today
      ).length);
    } catch (err) { console.error(err); }
    finally { setActivityLoading(false); }
  }

  async function loadHeatmap() {
    try {
      const year = new Date().getUTCFullYear().toString();
      const snap = await getDoc(doc(db, "heatmap", currentUser.uid, "years", year));
      if (snap.exists()) setHeatmapData(snap.data());
    } catch { /* ignore non-critical errors */ }
  }

  async function loadWeeklyChallenge() {
    try {
      const snap = await getDoc(doc(db, "config", "weeklyFreeChallenge"));
      if (!snap.exists()) return;
      const { challengeId } = snap.data();
      if (!challengeId) return;
      const cSnap = await getDoc(doc(db, "challenges", challengeId));
      if (cSnap.exists()) setWeeklyChallenge({ id: cSnap.id, ...cSnap.data() });
    } catch { /* ignore non-critical errors */ }
  }

  if (!userProfile) {
    return (
      <PageWrapper>
        <div className="dash-loading">
          <div className="dash-loading-spinner" />
          <span>Loading your profile...</span>
        </div>
      </PageWrapper>
    );
  }

  const username      = userProfile.username || "Analyst";
  const elo           = userProfile.elo || 0;
  const weeklyElo     = userProfile.weeklyElo || 0;
  const totalSolved   = userProfile.totalSolved || 0;
  const currentStreak = userProfile.currentStreak || 0;
  const maxStreak     = userProfile.maxStreak || 0;
  const correct       = userProfile.correctSubmissions || 0;
  const wrong         = userProfile.wrongSubmissions || 0;
  const accuracy      = correct + wrong > 0 ? Math.round((correct / (correct + wrong)) * 100) : 0;
  const dailyRemaining = isPro ? "∞" : Math.max(0, 5 - todaySolves);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <PageWrapper>
      <div className="dash-page">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="dash-header">
          <div className="dash-greeting">
            <span className="dash-greeting-time">{greeting},</span>
            <h1 className="dash-greeting-name">
              {username}
              {isPro && <span className="dash-pro-badge">PRO</span>}
            </h1>
          </div>
          <Link to="/challenges" className="dash-cta-btn">
            Start a Challenge →
          </Link>
        </div>

        {/* ── Daily limit ─────────────────────────────────────────────── */}
        {!isPro && (
          <div className="dash-daily-limit">
            <div className="dash-daily-limit-info">
              <span className="dash-daily-limit-label">Daily challenges</span>
              <span className="dash-daily-limit-count">{todaySolves} / 5 used</span>
            </div>
            <div className="dash-daily-bar">
              <div className="dash-daily-bar-fill" style={{ width: `${(todaySolves / 5) * 100}%` }} />
            </div>
            {todaySolves >= 5 && (
              <p className="dash-daily-limit-msg">
                Daily limit reached. <Link to="/pricing" className="dash-upgrade-link">Upgrade to Pro</Link> for unlimited access.
              </p>
            )}
          </div>
        )}

        {/* ── Welcome banner for new users ─────────────────────────────── */}
        {totalSolved === 0 && (
          <div className="dash-welcome-banner">
            <div className="dash-welcome-text">
              <span className="dash-welcome-title">👋 Welcome to PwnGrid</span>
              <span className="dash-welcome-sub">Start your first challenge to begin your intelligence journey and earn your first ELO points.</span>
            </div>
            <Link to="/challenges" className="dash-welcome-cta">Begin →</Link>
          </div>
        )}

        {/* ── Weekly free challenge hero ───────────────────────────────── */}
        {weeklyChallenge && !isPro && (
          <div className="dash-hero-challenge">
            <div className="dash-hero-challenge-bg" aria-hidden />
            <div className="dash-hero-challenge-left">
              <span className="dash-hero-challenge-eyebrow">🔓 Free This Week</span>
              <h2 className="dash-hero-challenge-title">{weeklyChallenge.title}</h2>
              <div className="dash-hero-challenge-meta">
                <span className={`dash-hero-diff dash-hero-diff--${weeklyChallenge.difficulty}`}>
                  {weeklyChallenge.difficulty}
                </span>
                <span className="dash-hero-pts">+{weeklyChallenge.basePoints} pts</span>
                <span className="dash-hero-category">{weeklyChallenge.category}</span>
              </div>
            </div>
            <Link to={`/challenges/${weeklyChallenge.slug}`} className="dash-hero-challenge-cta">
              Try Now →
            </Link>
          </div>
        )}

        {/* ── Stats grid ──────────────────────────────────────────────── */}
        <div className="dash-stats-grid">
          <StatCard label="Global ELO" value={elo.toLocaleString()} rawValue={elo}
            icon="◆" accent="accent" sub={`+${weeklyElo} this week`} />
          <StatCard label="Solved" value={totalSolved} rawValue={totalSolved}
            icon="✓" accent="blue" sub={`${accuracy}% accuracy`} />
          <StatCard label="Streak" value={`${currentStreak}d`} rawValue={currentStreak}
            icon="🔥" accent="warning" sub={`Best: ${maxStreak} days`} />
          <StatCard label="Today" value={isPro ? totalSolved : `${todaySolves}/5`} rawValue={todaySolves}
            icon="⊞" accent="subtle" sub={isPro ? "Unlimited" : `${dailyRemaining} remaining`} />
        </div>

        {/* ── Content ─────────────────────────────────────────────────── */}
        <div className="dash-content-grid">
          <div className="dash-card">
            <div className="dash-card-header">
              <span className="dash-card-title">Recent Activity</span>
              <Link to="/challenges" className="dash-card-link">View all →</Link>
            </div>
            {activityLoading ? (
              <div className="dash-activity-loading">
                {[...Array(4)].map((_, i) => <div key={i} className="dash-skeleton-row" />)}
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="dash-empty">
                <span className="dash-empty-icon">◈</span>
                <p>No activity yet.</p>
                <Link to="/challenges" className="dash-empty-link">Solve your first challenge →</Link>
              </div>
            ) : (
              <div className="dash-activity-list">
                {recentActivity.map(item => <ActivityRow key={item.id} item={item} />)}
              </div>
            )}
          </div>

          <div className="dash-side">
            <SocialPanel />

            <div className="dash-card dash-elo-card">
              <div className="dash-card-header">
                <span className="dash-card-title">ELO Rank</span>
              </div>
              <EloTierDisplay elo={elo} />
            </div>

            <div className="dash-quick-links">
              <Link to="/leaderboard"  className="dash-quick-link"><span className="dash-quick-link-icon">⊞</span>Leaderboard</Link>
              <Link to="/profile"      className="dash-quick-link"><span className="dash-quick-link-icon">⊙</span>My Profile</Link>
              <Link to="/contests"     className="dash-quick-link">
                <span className="dash-quick-link-icon">⬡</span>Contests
                {!isPro && <span className="dash-quick-pro">PRO</span>}
              </Link>
              {!isPro && (
                <Link to="/pricing" className="dash-quick-link dash-quick-link--upgrade">
                  <span className="dash-quick-link-icon">⬆</span>Upgrade to Pro
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, accent, sub }) {
  return (
    <div className={`dash-stat-card dash-stat-card--${accent}`}>
      <div className="dash-stat-card-header">
        <span className="dash-stat-label">{label}</span>
        <span className="dash-stat-icon">{icon}</span>
      </div>
      <div className="dash-stat-value">{value}</div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
  );
}

function ActivityRow({ item }) {
  const DIFF_COLOR = { easy: "var(--color-easy)", medium: "var(--color-medium)", hard: "var(--color-hard)" };
  const ts = item.timestamp?.toDate();
  return (
    <div className={`dash-activity-row dash-activity-row--${item.isCorrect ? "correct" : "wrong"}`}>
      <span className="dash-activity-icon">{item.isCorrect ? "✓" : "✗"}</span>
      <div className="dash-activity-info">
        <span className="dash-activity-title"
          onClick={() => item.challengeSlug && (window.location.href = `/challenges/${item.challengeSlug}`)}
          style={{ cursor: item.challengeSlug ? "pointer" : "default" }}>
          {item.challengeTitle}
        </span>
        <span className="dash-activity-meta">
          <span style={{ color: DIFF_COLOR[item.difficulty] || "var(--color-text-subtle)" }}>{item.difficulty}</span>
          {" · "}{ts ? formatRelativeTime(ts) : ""}
        </span>
      </div>
      <span className={`dash-activity-elo dash-activity-elo--${item.eloChange > 0 ? "pos" : "neg"}`}>
        {item.eloChange > 0 ? "+" : ""}{item.eloChange}
      </span>
    </div>
  );
}

function MiniHeatmap({ data }) {
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const days = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().split("T")[0];
    days.push({ key, count: data[key] || 0 });
  }
  const getColor = c => c === 0 ? "rgba(255,255,255,0.04)" : c === 1 ? "rgba(0,255,136,0.25)" : c <= 3 ? "rgba(0,255,136,0.55)" : "var(--color-accent)";
  return (
    <div className="dash-heatmap">
      {days.map(({ key, count }) => (
        <div key={key} className="dash-heatmap-cell"
          style={{ background: getColor(count) }}
          title={`${key}: ${count} solve${count !== 1 ? "s" : ""}`} />
      ))}
    </div>
  );
}

function EloTierDisplay({ elo }) {
  const tiers = [
    { name: "Recruit",  min: 0,    max: 199,      color: "#8B949E" },
    { name: "Analyst",  min: 200,  max: 499,      color: "#CD7F32" },
    { name: "Agent",    min: 500,  max: 999,      color: "#C0C0C0" },
    { name: "Operator", min: 1000, max: 1999,     color: "#FFD700" },
    { name: "Elite",    min: 2000, max: 3999,     color: "#00BFFF" },
    { name: "Phantom",  min: 4000, max: Infinity, color: "#00FF88" },
  ];
  const tier = tiers.find(t => elo >= t.min && elo <= t.max) || tiers[0];
  const next = tiers[tiers.indexOf(tier) + 1];
  const progress = next ? Math.min(100, ((elo - tier.min) / (next.min - tier.min)) * 100) : 100;
  return (
    <div className="dash-elo-tier">
      <div className="dash-elo-tier-name" style={{ color: tier.color }}>{tier.name}</div>
      <div className="dash-elo-tier-elo">{elo.toLocaleString()} ELO</div>
      {next && (
        <>
          <div className="dash-elo-progress-bar">
            <div className="dash-elo-progress-fill" style={{ width: `${progress}%`, background: tier.color }} />
          </div>
          <div className="dash-elo-tier-next">{next.min - elo} ELO to {next.name}</div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}