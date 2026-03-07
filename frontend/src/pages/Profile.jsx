/**
 * Profile.jsx
 * Public profile page — viewable by anyone logged in.
 * /profile             → own profile (from AuthContext)
 * /profile/:username   → another user's profile
 *
 * Shows: avatar, ELO, tier, stats, heatmap, recent solves, badges.
 *
 * File location: frontend/src/pages/Profile.jsx
 */

import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  collection, query, where, orderBy,
  limit, getDocs, doc, getDoc,
  setDoc, deleteDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import PageWrapper from "../components/layout/PageWrapper";
import "./Profile.css";

// Preset avatar emoji map (matches EditProfile.jsx)
const PRESET_MAP = {
  spy: "🕵️", ghost: "👻", wolf: "🐺", robot: "🤖",
  alien: "👽", ninja: "🥷", dragon: "🐉", falcon: "🦅",
  owl: "🦉", shark: "🦈", fox: "🦊", panther: "🐆",
};

const ELO_TIERS = [
  { name: "Recruit",  min: 0,    max: 199,    color: "#8B949E" },
  { name: "Analyst",  min: 200,  max: 499,    color: "#CD7F32" },
  { name: "Agent",    min: 500,  max: 999,    color: "#C0C0C0" },
  { name: "Operator", min: 1000, max: 1999,   color: "#FFD700" },
  { name: "Elite",    min: 2000, max: 3999,   color: "#00BFFF" },
  { name: "Phantom",  min: 4000, max: Infinity, color: "#00FF88" },
];

const DIFF_COLOR = {
  easy:   "var(--color-easy)",
  medium: "var(--color-medium)",
  hard:   "var(--color-hard)",
};

export default function Profile() {
  const { username: usernameParam } = useParams();
  const { currentUser, userProfile: ownProfile } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile]         = useState(null);
  const [userId, setUserId]           = useState(null);
  const [loading, setLoading]         = useState(true);
  const [notFound, setNotFound]       = useState(false);
  const [recentSolves, setRecentSolves] = useState([]);
  const [heatmapData, setHeatmapData] = useState({});
  const [badges, setBadges]           = useState([]);
  const [activeTab, setActiveTab]     = useState("activity");

  const isOwnProfile = !usernameParam || (ownProfile?.username === usernameParam);
  const [isFollowing, setIsFollowing]   = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (isOwnProfile && ownProfile) {
      setProfile(ownProfile);
      setUserId(currentUser.uid);
      loadProfileData(currentUser.uid);
    } else if (usernameParam) {
      loadByUsername(usernameParam);
    }
  }, [usernameParam, ownProfile, isOwnProfile]);

  // Check follow status when viewing another user
  useEffect(() => {
    if (!isOwnProfile && userId && currentUser) {
      checkFollowStatus(userId);
    }
  }, [userId, isOwnProfile]);

  async function checkFollowStatus(targetUid) {
    try {
      const followId = `${currentUser.uid}_${targetUid}`;
      const snap = await getDoc(doc(db, "follows", followId));
      setIsFollowing(snap.exists());
    } catch {}
  }

  async function handleFollow() {
    if (!userId) return;
    setFollowLoading(true);
    try {
      const followId = `${currentUser.uid}_${userId}`;
      if (isFollowing) {
        await deleteDoc(doc(db, "follows", followId));
        setIsFollowing(false);
      } else {
        await setDoc(doc(db, "follows", followId), {
          followerId:  currentUser.uid,
          followingId: userId,
          createdAt:   serverTimestamp(),
        });
        setIsFollowing(true);
      }
    } catch (err) {
      console.error("follow error:", err);
    } finally {
      setFollowLoading(false);
    }
  }

  async function loadByUsername(username) {
    setLoading(true);
    try {
      // First try publicProfiles
      const q = query(
        collection(db, "publicProfiles"),
        where("username", "==", username),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        // Fallback: try users collection directly
        const q2 = query(
          collection(db, "users"),
          where("username", "==", username),
          limit(1)
        );
        const snap2 = await getDocs(q2);
        if (snap2.empty) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        const d2 = snap2.docs[0];
        setProfile({ uid: d2.id, ...d2.data() });
        setUserId(d2.id);
        loadProfileData(d2.id);
        return;
      }
      const docSnap = snap.docs[0];
      const uid = docSnap.id;
      // Also fetch full user doc to get badges, streak, accuracy etc.
      try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (userSnap.exists()) {
          setProfile({ uid, ...userSnap.data(), ...docSnap.data() });
        } else {
          setProfile({ uid, ...docSnap.data() });
        }
      } catch {
        setProfile({ uid, ...docSnap.data() });
      }
      setUserId(uid);
      loadProfileData(uid);
    } catch (err) {
      console.error("loadByUsername:", err);
      setLoading(false);
    }
  }

  async function loadProfileData(uid) {
    setLoading(true);
    try {
      await Promise.all([
        loadRecentSolves(uid),
        loadHeatmap(uid),
        loadBadges(uid),
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentSolves(uid) {
    try {
      const q = query(
        collection(db, "submissions"),
        where("userId", "==", uid),
        where("isCorrect", "==", true),
        orderBy("timestamp", "desc"),
        limit(10)
      );
      const snap = await getDocs(q);
      const solves = [];
      for (const docSnap of snap.docs) {
        const sub = docSnap.data();
        let title = sub.challengeId;
        let difficulty = "easy";
        let slug = "";
        try {
          const cSnap = await getDoc(doc(db, "challenges", sub.challengeId));
          if (cSnap.exists()) {
            title = cSnap.data().title;
            difficulty = cSnap.data().difficulty;
            slug = cSnap.data().slug;
          }
        } catch {}
        solves.push({ id: docSnap.id, ...sub, title, difficulty, slug });
      }
      setRecentSolves(solves);
    } catch {}
  }

  async function loadHeatmap(uid) {
    try {
      const year = new Date().getUTCFullYear().toString();
      const snap = await getDoc(doc(db, "heatmap", uid, "years", year));
      if (snap.exists()) setHeatmapData(snap.data());
    } catch {}
  }

  async function loadBadges(uid) {
    try {
      const q = query(
        collection(db, "badges"),
        where("userId", "==", uid),
        orderBy("awardedAt", "desc")
      );
      const snap = await getDocs(q);
      setBadges(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {}
  }

  if (notFound) {
    return (
      <PageWrapper>
        <div className="profile-notfound">
          <span className="profile-notfound-icon">⊘</span>
          <h2>User not found</h2>
          <p>No analyst with the username <strong>{usernameParam}</strong> exists.</p>
          <Link to="/leaderboard" className="profile-notfound-link">
            Browse leaderboard →
          </Link>
        </div>
      </PageWrapper>
    );
  }

  if (loading || !profile) {
    return (
      <PageWrapper>
        <div className="profile-loading">
          <div className="profile-loading-spinner" />
          <span>Loading profile...</span>
        </div>
      </PageWrapper>
    );
  }

  const elo           = profile.elo || 0;
  const tier          = ELO_TIERS.find(t => elo >= t.min && elo <= t.max) || ELO_TIERS[0];
  const nextTier      = ELO_TIERS[ELO_TIERS.indexOf(tier) + 1];
  const tierProgress  = nextTier
    ? Math.min(100, ((elo - tier.min) / (nextTier.min - tier.min)) * 100)
    : 100;
  const totalSolved   = profile.totalSolved || 0;
  const correct       = profile.correctSubmissions || 0;
  const wrong         = profile.wrongSubmissions || 0;
  const accuracy      = correct + wrong > 0 ? Math.round((correct / (correct + wrong)) * 100) : 0;
  const currentStreak = profile.currentStreak || 0;
  const maxStreak     = profile.maxStreak || 0;
  const weeklyElo     = profile.weeklyElo || 0;
  const joinedDate    = profile.createdAt?.toDate
    ? profile.createdAt.toDate().toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "—";

  return (
    <PageWrapper>
      <div className="profile-page">

        {/* ── Hero banner ───────────────────────────────────────────────── */}
        <div className="profile-hero" style={{ "--tier-color": tier.color }}>
          <div className="profile-hero-bg" aria-hidden="true" />

          <div className="profile-hero-content">
            {/* Avatar */}
            <div className="profile-avatar-wrap">
              {profile.photoURL && !profile.photoURL.startsWith("preset:") ? (
                <img
                  src={profile.photoURL}
                  alt={profile.username}
                  className="profile-avatar profile-avatar--photo"
                />
              ) : profile.photoURL?.startsWith("preset:") ? (
                <div className="profile-avatar profile-avatar--preset"
                  style={{ borderColor: tier.color }}>
                  {PRESET_MAP[profile.photoURL.replace("preset:", "")] || "🕵️"}
                </div>
              ) : (
                <div className="profile-avatar profile-avatar--initial"
                  style={{ background: tier.color }}>
                  {(profile.username || "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div
                className="profile-avatar-ring"
                style={{ borderColor: tier.color }}
              />
            </div>

            {/* Identity */}
            <div className="profile-identity">
              <div className="profile-name-row">
                <h1 className="profile-username">{profile.username}</h1>
                {profile.plan === "pro" && (
                  <span className="profile-pro-badge">PRO</span>
                )}
                {isOwnProfile && (
                  <span className="profile-own-badge">You</span>
                )}
                {isOwnProfile && (
                  <Link to="/profile/edit" className="profile-edit-btn">✎ Edit Profile</Link>
                )}
                {!isOwnProfile && (
                  <button
                    className={`profile-follow-btn ${isFollowing ? "profile-follow-btn--following" : ""}`}
                    onClick={handleFollow}
                    disabled={followLoading}
                  >
                    {followLoading ? "..." : isFollowing ? "✓ Following" : "+ Follow"}
                  </button>
                )}
              </div>
              <div
                className="profile-tier-label"
                style={{ color: tier.color }}
              >
                {tier.name}
              </div>
              <div className="profile-join-date">
                Analyst since {joinedDate}
                {profile.university && <span className="profile-university"> · {profile.university}</span>}
                {profile.country && <span className="profile-country"> · {profile.country}</span>}
              </div>
              {profile.bio && <div className="profile-bio">{profile.bio}</div>}
            </div>

            {/* ELO display */}
            <div className="profile-elo-block">
              <div className="profile-elo-value" style={{ color: tier.color }}>
                {elo.toLocaleString()}
              </div>
              <div className="profile-elo-label">Global ELO</div>
              <div className="profile-elo-progress">
                <div
                  className="profile-elo-bar"
                  style={{ width: `${tierProgress}%`, background: tier.color }}
                />
              </div>
              {nextTier && (
                <div className="profile-elo-next">
                  {(nextTier.min - elo).toLocaleString()} to {nextTier.name}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats row ─────────────────────────────────────────────────── */}
        <div className="profile-stats-row">
          <ProfileStat label="Solved"        value={totalSolved}     accent />
          <ProfileStat label="Accuracy"      value={`${accuracy}%`}  />
          <ProfileStat label="Streak"        value={`${currentStreak}d`} icon="🔥" />
          <ProfileStat label="Best Streak"   value={`${maxStreak}d`} />
          <ProfileStat label="Weekly ELO"    value={`+${weeklyElo}`} />
          <ProfileStat label="Badges"        value={badges.length}   />
        </div>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className="profile-content">

          {/* Left column */}
          <div className="profile-main">

            {/* Heatmap */}
            <div className="profile-card">
              <div className="profile-card-header">
                <span className="profile-card-title">Activity Heatmap</span>
                <span className="profile-card-sub">{totalSolved} total solves</span>
              </div>
              <ProfileHeatmap data={heatmapData} tierColor={tier.color} />
            </div>

            {/* Tabs: activity / badges */}
            <div className="profile-card profile-card--flush">
              <div className="profile-tabs">
                <button
                  className={`profile-tab ${activeTab === "activity" ? "profile-tab--active" : ""}`}
                  onClick={() => setActiveTab("activity")}
                >
                  Recent Solves
                </button>
                <button
                  className={`profile-tab ${activeTab === "badges" ? "profile-tab--active" : ""}`}
                  onClick={() => setActiveTab("badges")}
                >
                  Badges
                  {badges.length > 0 && (
                    <span className="profile-tab-count">{badges.length}</span>
                  )}
                </button>
              </div>

              <div className="profile-tab-content">
                {activeTab === "activity" && (
                  <ActivityTab solves={recentSolves} />
                )}
                {activeTab === "badges" && (
                  <BadgesTab badges={badges} />
                )}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="profile-side">

            {/* Difficulty breakdown */}
            <div className="profile-card">
              <div className="profile-card-header">
                <span className="profile-card-title">Solved by Difficulty</span>
              </div>
              <DiffBreakdown counts={profile.solvedByDifficulty} totalSolved={totalSolved} />
            </div>

            {/* Streak calendar */}
            <div className="profile-card">
              <div className="profile-card-header">
                <span className="profile-card-title">Streak</span>
              </div>
              <div className="profile-streak-display">
                <span className="profile-streak-fire">🔥</span>
                <span className="profile-streak-number">{currentStreak}</span>
                <span className="profile-streak-label">day streak</span>
              </div>
              <div className="profile-streak-best">
                Best: {maxStreak} days
              </div>
            </div>

          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProfileStat({ label, value, accent, icon }) {
  return (
    <div className="profile-stat">
      <div className={`profile-stat-value ${accent ? "profile-stat-value--accent" : ""}`}>
        {icon && <span className="profile-stat-icon">{icon}</span>}
        {value}
      </div>
      <div className="profile-stat-label">{label}</div>
    </div>
  );
}

function ProfileHeatmap({ data, tierColor }) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const weeks = 26;
  const days = [];
  for (let i = weeks * 7 - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().split("T")[0];
    const count = data[key] || 0;
    days.push({ key, count, dayOfWeek: d.getUTCDay() });
  }

  function getColor(count) {
    if (count === 0) return "var(--color-surface-2)";
    if (count === 1) return "rgba(0,255,136,0.25)";
    if (count <= 3)  return "rgba(0,255,136,0.5)";
    return "var(--color-accent)";
  }

  const months = [];
  let lastMonth = -1;
  days.forEach((d, i) => {
    const month = new Date(d.key).getUTCMonth();
    if (month !== lastMonth && i % 7 === 0) {
      months.push({ month, weekIndex: Math.floor(i / 7) });
      lastMonth = month;
    }
  });
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div className="profile-heatmap-wrap">
      <div className="profile-heatmap-months">
        {months.map((m, i) => (
          <span
            key={i}
            className="profile-heatmap-month"
            style={{ left: `${m.weekIndex * 17}px` }}
          >
            {monthNames[m.month]}
          </span>
        ))}
      </div>
      <div className="profile-heatmap">
        {days.map(({ key, count }) => (
          <div
            key={key}
            className="profile-heatmap-cell"
            style={{ background: getColor(count) }}
            title={`${key}: ${count} solve${count !== 1 ? "s" : ""}`}
          />
        ))}
      </div>
      <div className="profile-heatmap-legend">
        <span>Less</span>
        {[0,1,2,4].map(c => (
          <div
            key={c}
            className="profile-heatmap-cell profile-heatmap-cell--legend"
            style={{ background: getColor(c) }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function ActivityTab({ solves }) {
  if (solves.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">◈</span>
        <p>No solves yet.</p>
        <a href="/challenges" className="profile-empty-link">Start a challenge →</a>
      </div>
    );
  }
  return (
    <div className="profile-activity-list">
      {solves.map((solve) => {
        const ts = solve.timestamp?.toDate();
        return (
          <div key={solve.id} className="profile-activity-row">
            <span
              className="profile-activity-diff-dot"
              style={{ background: DIFF_COLOR[solve.difficulty] || "var(--color-text-subtle)" }}
            />
            <div className="profile-activity-info">
              <span className="profile-activity-title">
                {solve.slug ? (
                  <Link to={`/challenges/${solve.slug}`} className="profile-activity-link">
                    {solve.title}
                  </Link>
                ) : solve.title}
              </span>
              <span className="profile-activity-meta">
                <span style={{ color: DIFF_COLOR[solve.difficulty] }}>
                  {solve.difficulty}
                </span>
                {ts && ` · ${formatRelativeTime(ts)}`}
              </span>
            </div>
            <span className="profile-activity-elo">
              +{solve.eloChange || 0}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BadgesTab({ badges }) {
  const ALL_BADGES = [
    { type: "speed_demon",   icon: "⚡", label: "Speed Demon",   desc: "Solve 10 challenges with 2× time bonus" },
    { type: "streak_master", icon: "🔥", label: "Streak Master",  desc: "Maintain a 30-day solving streak" },
    { type: "first_blood",   icon: "🩸", label: "First Blood",    desc: "Be the first to solve a challenge" },
    { type: "centurion",     icon: "💯", label: "Centurion",      desc: "Solve 100 challenges" },
    { type: "phantom",       icon: "👻", label: "Phantom",        desc: "Reach Phantom tier (4000+ ELO)" },
    { type: "analyst",       icon: "🔍", label: "Analyst",        desc: "Solve your first hard challenge" },
    { type: "consistent",    icon: "📅", label: "Consistent",     desc: "Solve challenges 7 days in a row" },
    { type: "elite",         icon: "⭐", label: "Elite",          desc: "Reach Elite tier (2000+ ELO)" },
  ];

  const earned = new Set(badges.map(b => b.type));

  return (
    <div className="profile-badges-grid">
      {ALL_BADGES.map((badge) => {
        const isEarned = earned.has(badge.type);
        return (
          <div key={badge.type}
            className={`profile-badge ${isEarned ? "profile-badge--earned" : "profile-badge--locked"}`}
            title={isEarned ? badge.desc : `Locked: ${badge.desc}`}>
            <span className="profile-badge-icon">{badge.icon}</span>
            <span className="profile-badge-label">{badge.label}</span>
            {!isEarned && <span className="profile-badge-lock">🔒</span>}
          </div>
        );
      })}
    </div>
  );
}

function DiffBreakdown({ counts = {}, totalSolved = 0 }) {
  const resolved = {
    easy:   counts?.easy   || 0,
    medium: counts?.medium || 0,
    hard:   counts?.hard   || 0,
  };
  const total = Math.max(totalSolved, resolved.easy + resolved.medium + resolved.hard, 1);

  return (
    <div className="profile-diff-breakdown">
      {["easy", "medium", "hard"].map(d => (
        <div key={d} className="profile-diff-row">
          <span className="profile-diff-label" style={{ color: DIFF_COLOR[d] }}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </span>
          <div className="profile-diff-bar-wrap">
            <div
              className="profile-diff-bar"
              style={{
                width: `${(resolved[d] / total) * 100}%`,
                background: DIFF_COLOR[d],
              }}
            />
          </div>
          <span className="profile-diff-count">{resolved[d]}</span>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatRelativeTime(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}