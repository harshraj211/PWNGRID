/**
 * AdminDashboard.jsx — v3
 * Uses only single-field queries — zero composite indexes needed.
 * File location: frontend/src/pages/admin/AdminDashboard.jsx
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  collection, query, orderBy, limit,
  getDocs, getCountFromServer,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import "./Admin.css";

export default function AdminDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => { loadAnalytics(); }, []);

  async function loadAnalytics() {
    setLoading(true);
    setError("");
    try {
      const usersRef = collection(db, "users");
      const subRef   = collection(db, "submissions");
      const chalRef  = collection(db, "challenges");
      const flagsRef = collection(db, "flags");

      // Only simple single-field queries — no composite indexes needed
      const [
        totalUsersSnap,
        totalSubsSnap,
        totalChalSnap,
        recentUsersSnap,
        topUsersSnap,
        recentSubsSnap,
        allFlagsSnap,
      ] = await Promise.all([
        getCountFromServer(usersRef),
        getCountFromServer(subRef),
        getCountFromServer(chalRef),
        getDocs(query(usersRef, orderBy("createdAt", "desc"), limit(5))),
        getDocs(query(usersRef, orderBy("elo",       "desc"), limit(5))),
        getDocs(query(subRef,   orderBy("timestamp", "desc"), limit(50))),
        getDocs(query(flagsRef, orderBy("createdAt", "desc"), limit(100))),
      ]);

      // Compute stats client-side from recent docs
      const now       = Date.now();
      const oneDayMs  = 86400000;
      const oneWeekMs = 7 * oneDayMs;

      const recentSubs = recentSubsSnap.docs.map(d => d.data());
      const todaySubs  = recentSubs.filter(s => s.timestamp?.toMillis?.() > now - oneDayMs);
      const correctToday = todaySubs.filter(s => s.isCorrect).length;
      const totalToday   = todaySubs.length;

      const recentUsers = recentUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const newThisWeek = recentUsers.filter(u =>
        u.createdAt?.toMillis?.() > now - oneWeekMs
      ).length;

      const allFlags = allFlagsSnap.docs.map(d => d.data());
      const openFlags = allFlags.filter(f => !f.resolved).length;

      setData({
        users: {
          total:       totalUsersSnap.data().count,
          newThisWeek,
          recentUsers,
          topUsers: topUsersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        },
        submissions: {
          total:         totalSubsSnap.data().count,
          totalToday,
          correctToday,
          accuracyToday: totalToday > 0 ? Math.round((correctToday / totalToday) * 100) : 0,
        },
        challenges: {
          total: totalChalSnap.data().count,
        },
        flags: {
          totalUnresolved: openFlags,
        },
      });
      setLastRefresh(new Date());
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <AdminLoading label="Loading analytics..." />;
  if (error)   return <AdminError error={error} onRetry={loadAnalytics} />;
  if (!data)   return null;

  const { users, challenges, submissions, flags } = data;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Dashboard</h1>
          {lastRefresh && (
            <p className="admin-page-sub">Last updated {lastRefresh.toLocaleTimeString()}</p>
          )}
        </div>
        <button className="admin-refresh-btn" onClick={loadAnalytics}>↻ Refresh</button>
      </div>

      {flags?.totalUnresolved > 0 && (
        <Link to="/admin/flags" className="admin-flags-alert">
          <span className="admin-flags-alert-icon">⚑</span>
          <span>{flags.totalUnresolved} unresolved flag{flags.totalUnresolved !== 1 ? "s" : ""} need attention</span>
          <span className="admin-flags-alert-arrow">→</span>
        </Link>
      )}

      <section className="admin-section">
        <h2 className="admin-section-title">Overview</h2>
        <div className="admin-stats-grid admin-stats-grid--5">
          <AdminStat label="Total Users"      value={users?.total?.toLocaleString()} />
          <AdminStat label="New This Week"    value={`+${users?.newThisWeek ?? 0}`} accent="accent" />
          <AdminStat label="Total Challenges" value={challenges?.total?.toLocaleString()} />
          <AdminStat label="Total Submissions" value={submissions?.total?.toLocaleString()} />
          <AdminStat label="Open Flags"       value={flags?.totalUnresolved ?? 0}
            accent={flags?.totalUnresolved > 0 ? "warning" : ""} />
        </div>
      </section>

      <section className="admin-section">
        <h2 className="admin-section-title">Today&apos;s Activity</h2>
        <div className="admin-stats-grid admin-stats-grid--3">
          <AdminStat label="Submissions"  value={submissions?.totalToday} />
          <AdminStat label="Correct"      value={submissions?.correctToday} accent="accent" />
          <AdminStat label="Accuracy"     value={`${submissions?.accuracyToday ?? 0}%`}
            accent={submissions?.accuracyToday >= 50 ? "accent" : "warning"} />
        </div>
      </section>

      <div className="admin-two-col">
        <section className="admin-card">
          <h2 className="admin-card-title">Top Analysts by ELO</h2>
          <div className="admin-user-list">
            {users?.topUsers?.map((u, i) => (
              <div key={u.id} className="admin-user-row">
                <span className="admin-user-rank">#{i + 1}</span>
                <span className="admin-user-name">{u.username || u.email}</span>
                <span className="admin-user-elo">{u.elo ?? 500} ELO</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-card">
          <h2 className="admin-card-title">Recently Joined</h2>
          <div className="admin-user-list">
            {users?.recentUsers?.map(u => (
              <div key={u.id} className="admin-user-row">
                <span className="admin-user-name">{u.username || u.email}</span>
                <span className="admin-user-meta">{u.provider || "email"}</span>
                <span className="admin-user-date">
                  {u.createdAt?.toDate?.()?.toLocaleDateString() || "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="admin-section">
        <h2 className="admin-section-title">Quick Actions</h2>
        <div className="admin-quick-actions">
          <Link to="/admin/users"      className="admin-quick-btn">Manage Users →</Link>
          <Link to="/admin/flags"      className="admin-quick-btn">Review Flags →</Link>
          <Link to="/admin/challenges" className="admin-quick-btn">Manage Challenges →</Link>
        </div>
      </section>
    </div>
  );
}

function AdminStat({ label, value, accent }) {
  return (
    <div className={`admin-stat-card ${accent ? `admin-stat-card--${accent}` : ""}`}>
      <div className="admin-stat-value">{value ?? "—"}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}

export function AdminLoading({ label = "Loading..." }) {
  return (
    <div className="admin-loading">
      <div className="admin-loading-spinner" />
      <span>{label}</span>
    </div>
  );
}

export function AdminError({ error, onRetry }) {
  return (
    <div className="admin-error-state">
      <span className="admin-error-icon">⚠</span>
      <p>{error}</p>
      {onRetry && <button className="admin-retry-btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}