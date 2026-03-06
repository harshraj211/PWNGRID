/**
 * AdminUsers.jsx
 * User management: search, view, adjust ELO, ban/unban.
 * Calls: adjustElo Cloud Function.
 * Direct Firestore writes for plan + role changes.
 *
 * File location: frontend/src/pages/admin/AdminUsers.jsx
 */

import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit, getDocs,
  startAfter, where, doc, updateDoc, getDoc
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebase/config";
import { AdminLoading, AdminError } from "./AdminDashboard";
import "./Admin.css";

const functions    = getFunctions();
const adjustEloFn  = httpsCallable(functions, "adjustElo");
const resolveFlagFn = httpsCallable(functions, "resolveFlag");

const PAGE_SIZE = 25;

export default function AdminUsers() {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [lastDoc, setLastDoc]     = useState(null);
  const [error, setError]         = useState("");

  const [search, setSearch]       = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);

  const [selectedUser, setSelectedUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg]   = useState("");

  // ELO adjust modal
  const [eloModalOpen, setEloModalOpen] = useState(false);
  const [eloAdjust, setEloAdjust]       = useState("");
  const [eloReason, setEloReason]       = useState("");

  useEffect(() => { loadUsers(true); }, []);

  async function loadUsers(fresh = false) {
    if (fresh) setLoading(true);
    else setLoadingMore(true);
    setError("");

    try {
      let q = query(
        collection(db, "users"),
        orderBy("elo", "desc"),
        limit(PAGE_SIZE)
      );
      if (!fresh && lastDoc) q = query(q, startAfter(lastDoc));

      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setUsers(prev => fresh ? items : [...prev, ...items]);
      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      setError(err.message || "Failed to load users.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!search.trim()) { setSearchResult(null); return; }
    setSearching(true);
    setSearchResult(null);
    try {
      // Search by username (exact match on publicProfiles)
      const q = query(
        collection(db, "users"),
        where("username", "==", search.trim()),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setSearchResult({ notFound: true });
      } else {
        setSearchResult({ user: { id: snap.docs[0].id, ...snap.docs[0].data() } });
      }
    } catch (err) {
      setSearchResult({ error: err.message });
    } finally {
      setSearching(false);
    }
  }

  async function handleAdjustElo() {
    if (!selectedUser || !eloAdjust || !eloReason.trim()) return;
    const adj = parseInt(eloAdjust);
    if (isNaN(adj) || adj === 0) return;

    setActionLoading(true);
    setActionMsg("");
    try {
      const res = await adjustEloFn({
        targetUserId: selectedUser.id,
        adjustment:   adj,
        reason:       eloReason.trim(),
      });
      const { previousElo, newElo } = res.data;
      setActionMsg(`✓ ELO updated: ${previousElo} → ${newElo}`);
      setEloModalOpen(false);
      setEloAdjust("");
      setEloReason("");
      // Refresh selected user
      const snap = await getDoc(doc(db, "users", selectedUser.id));
      if (snap.exists()) setSelectedUser({ id: snap.id, ...snap.data() });
    } catch (err) {
      setActionMsg(`✗ ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetPlan(plan) {
    if (!selectedUser) return;
    setActionLoading(true);
    setActionMsg("");
    try {
      await updateDoc(doc(db, "users", selectedUser.id), { plan });
      setSelectedUser(prev => ({ ...prev, plan }));
      setActionMsg(`✓ Plan set to ${plan}`);
    } catch (err) {
      setActionMsg(`✗ ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSetRole(role) {
    if (!selectedUser) return;
    setActionLoading(true);
    setActionMsg("");
    try {
      await updateDoc(doc(db, "users", selectedUser.id), { role });
      setSelectedUser(prev => ({ ...prev, role }));
      setActionMsg(`✓ Role set to ${role}`);
    } catch (err) {
      setActionMsg(`✗ ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleBanToggle() {
    if (!selectedUser) return;
    const ban = !selectedUser.isBanned;
    setActionLoading(true);
    setActionMsg("");
    try {
      if (ban) {
        // Full ban via resolveFlag — creates a synthetic flag
        await updateDoc(doc(db, "users", selectedUser.id), {
          isBanned: true,
          bannedAt: new Date(),
          bannedByAdmin: true,
        });
      } else {
        await updateDoc(doc(db, "users", selectedUser.id), {
          isBanned: false,
          bannedAt: null,
        });
      }
      setSelectedUser(prev => ({ ...prev, isBanned: ban }));
      setActionMsg(`✓ User ${ban ? "banned" : "unbanned"}`);
    } catch (err) {
      setActionMsg(`✗ ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  const displayUsers = searchResult?.user
    ? [searchResult.user]
    : users;

  if (loading) return <AdminLoading label="Loading users..." />;
  if (error)   return <AdminError error={error} onRetry={() => loadUsers(true)} />;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Users</h1>
        <span className="admin-page-sub">{users.length}+ loaded</span>
      </div>

      {/* ── Search ──────────────────────────────────────────────────── */}
      <form className="admin-search-row" onSubmit={handleSearch}>
        <input
          type="text"
          className="admin-search-input"
          placeholder="Search by exact username..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button type="submit" className="admin-search-btn" disabled={searching}>
          {searching ? "Searching..." : "Search"}
        </button>
        {searchResult && (
          <button
            type="button"
            className="admin-search-clear"
            onClick={() => { setSearchResult(null); setSearch(""); }}
          >
            Clear
          </button>
        )}
      </form>

      {searchResult?.notFound && (
        <p className="admin-empty-note">No user found with that username.</p>
      )}

      <div className="admin-users-layout">

        {/* ── User table ──────────────────────────────────────────────── */}
        <div className="admin-users-table-wrap">
          <div className="admin-table-header admin-users-grid">
            <span>User</span>
            <span>ELO</span>
            <span>Plan</span>
            <span>Role</span>
            <span>Status</span>
          </div>

          <div className="admin-table-body">
            {displayUsers.map(user => (
              <div
                key={user.id}
                className={`admin-table-row admin-users-grid ${selectedUser?.id === user.id ? "admin-table-row--selected" : ""} ${user.isBanned ? "admin-table-row--banned" : ""}`}
                onClick={() => { setSelectedUser(user); setActionMsg(""); setEloModalOpen(false); }}
              >
                <span className="admin-user-cell">
                  <span className="admin-user-avatar">
                    {(user.username || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="admin-user-name">{user.username || user.email || user.id.slice(0, 8)}</span>
                </span>
                <span className="admin-mono">{(user.elo || 0).toLocaleString()}</span>
                <span>
                  <span className={`admin-chip ${user.plan === "pro" ? "admin-chip--pro" : "admin-chip--free"}`}>
                    {user.plan || "free"}
                  </span>
                </span>
                <span>
                  <span className={`admin-chip ${user.role === "admin" ? "admin-chip--admin" : user.role === "mod" ? "admin-chip--mod" : user.role === "contest_mod" ? "admin-chip--mod" : "admin-chip--user"}`}>
                    {user.role || "user"}
                  </span>
                </span>
                <span>
                  {user.isBanned
                    ? <span className="admin-chip admin-chip--banned">Banned</span>
                    : user.isFlagged
                      ? <span className="admin-chip admin-chip--flagged">Flagged</span>
                      : <span className="admin-chip admin-chip--ok">OK</span>
                  }
                </span>
              </div>
            ))}
          </div>

          {!searchResult && hasMore && (
            <div className="admin-load-more">
              <button
                className="admin-load-more-btn"
                onClick={() => loadUsers(false)}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </div>

        {/* ── User detail panel ───────────────────────────────────────── */}
        {selectedUser ? (
          <div className="admin-user-detail">
            <div className="admin-detail-header">
              <span className="admin-detail-username">{selectedUser.username}</span>
              <span className="admin-detail-id">{selectedUser.id}</span>
            </div>

            {/* Stats */}
            <div className="admin-detail-stats">
              <div className="admin-detail-stat">
                <span className="admin-detail-stat-value">{(selectedUser.elo || 0).toLocaleString()}</span>
                <span className="admin-detail-stat-label">ELO</span>
              </div>
              <div className="admin-detail-stat">
                <span className="admin-detail-stat-value">{selectedUser.totalSolved || 0}</span>
                <span className="admin-detail-stat-label">Solved</span>
              </div>
              <div className="admin-detail-stat">
                <span className="admin-detail-stat-value">{selectedUser.currentStreak || 0}d</span>
                <span className="admin-detail-stat-label">Streak</span>
              </div>
            </div>

            {/* Action feedback */}
            {actionMsg && (
              <div className={`admin-action-msg ${actionMsg.startsWith("✓") ? "admin-action-msg--ok" : "admin-action-msg--err"}`}>
                {actionMsg}
              </div>
            )}

            {/* ELO Adjust */}
            <div className="admin-detail-section">
              <span className="admin-detail-section-label">ELO Adjustment</span>
              {!eloModalOpen ? (
                <button className="admin-action-btn" onClick={() => setEloModalOpen(true)}>
                  Adjust ELO
                </button>
              ) : (
                <div className="admin-elo-form">
                  <input
                    type="number"
                    className="admin-input"
                    placeholder="±amount (e.g. 100 or -50)"
                    value={eloAdjust}
                    onChange={e => setEloAdjust(e.target.value)}
                  />
                  <input
                    type="text"
                    className="admin-input"
                    placeholder="Reason (min 10 chars)"
                    value={eloReason}
                    onChange={e => setEloReason(e.target.value)}
                  />
                  <div className="admin-elo-form-actions">
                    <button
                      className="admin-action-btn admin-action-btn--primary"
                      onClick={handleAdjustElo}
                      disabled={actionLoading || !eloAdjust || eloReason.length < 10}
                    >
                      {actionLoading ? "Saving..." : "Apply"}
                    </button>
                    <button
                      className="admin-action-btn"
                      onClick={() => { setEloModalOpen(false); setEloAdjust(""); setEloReason(""); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Plan */}
            <div className="admin-detail-section">
              <span className="admin-detail-section-label">Plan</span>
              <div className="admin-btn-group">
                <button
                  className={`admin-toggle-btn ${selectedUser.plan !== "pro" ? "admin-toggle-btn--active" : ""}`}
                  onClick={() => handleSetPlan("free")}
                  disabled={actionLoading}
                >Free</button>
                <button
                  className={`admin-toggle-btn ${selectedUser.plan === "pro" ? "admin-toggle-btn--active admin-toggle-btn--pro" : ""}`}
                  onClick={() => handleSetPlan("pro")}
                  disabled={actionLoading}
                >Pro</button>
              </div>
            </div>

            {/* Role */}
            <div className="admin-detail-section">
              <span className="admin-detail-section-label">Role</span>
              <div className="admin-btn-group">
                {["user","contest_mod","mod","admin"].map(r => (
                  <button
                    key={r}
                    className={`admin-toggle-btn ${selectedUser.role === r ? "admin-toggle-btn--active" : ""}`}
                    onClick={() => handleSetRole(r)}
                    disabled={actionLoading}
                  >{r}</button>
                ))}
              </div>
            </div>

            {/* Ban */}
            <div className="admin-detail-section">
              <span className="admin-detail-section-label">Account</span>
              <button
                className={`admin-action-btn ${selectedUser.isBanned ? "admin-action-btn--unban" : "admin-action-btn--danger"}`}
                onClick={handleBanToggle}
                disabled={actionLoading}
              >
                {actionLoading ? "Saving..." : selectedUser.isBanned ? "Unban user" : "Ban user"}
              </button>
            </div>

          </div>
        ) : (
          <div className="admin-user-detail admin-user-detail--empty">
            <span className="admin-empty-icon">⊙</span>
            <p>Select a user to view details</p>
          </div>
        )}

      </div>
    </div>
  );
}