/**
 * AdminFlags.jsx
 * Flag review queue — dismiss, warn, or ban.
 * Calls resolveFlag Cloud Function.
 *
 * File location: frontend/src/pages/admin/AdminFlags.jsx
 */

import { useState, useEffect } from "react";
import {
  collection, query, where, orderBy,
  limit, getDocs, doc, getDoc
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "../../firebase/config";
import { AdminLoading, AdminError } from "./AdminDashboard";
import "./Admin.css";

const functions     = getFunctions();
const resolveFlagFn = httpsCallable(functions, "resolveFlag");

const ACTION_CONFIG = {
  dismiss: { label: "Dismiss",     color: "var(--color-text-muted)",  bg: "var(--color-surface-2)",       confirm: false },
  warn:    { label: "Warn user",   color: "var(--color-warning)",     bg: "rgba(255,149,0,0.1)",           confirm: true  },
  ban:     { label: "Ban user",    color: "var(--color-error)",       bg: "rgba(255,77,77,0.1)",           confirm: true  },
};

export default function AdminFlags() {
  const [flags, setFlags]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [filter, setFilter]     = useState("unresolved");

  const [selectedFlag, setSelectedFlag] = useState(null);
  const [resolving, setResolving]       = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [confirmAction, setConfirmAction] = useState(null); // "warn" | "ban"
  const [feedback, setFeedback]         = useState("");

  useEffect(() => { loadFlags(); }, [filter]);

  async function loadFlags() {
    setLoading(true);
    setError("");
    setSelectedFlag(null);
    try {
      // Simple query without composite index — filter client-side
      const q = query(
        collection(db, "flags"),
        orderBy("createdAt", "desc"),
        limit(100)
      );
      const snap = await getDocs(q);
      const items = [];
      for (const flagDoc of snap.docs) {
        const flag = flagDoc.data();
        // Enrich with usernames
        let reportedUsername  = flag.reportedUserId?.slice(0, 8);
        let reportedByUsername = flag.reportedByUserId?.slice(0, 8);
        try {
          const snap1 = await getDoc(doc(db, "users", flag.reportedUserId));
          if (snap1.exists()) reportedUsername = snap1.data().username || reportedUsername;
        } catch { /* ignore non-critical errors */ }
        try {
          const snap2 = await getDoc(doc(db, "users", flag.reportedByUserId));
          if (snap2.exists()) reportedByUsername = snap2.data().username || reportedByUsername;
        } catch { /* ignore non-critical errors */ }

        items.push({
          id: flagDoc.id,
          ...flag,
          reportedUsername,
          reportedByUsername,
        });
      }
      // Client-side filter by status
      const filtered = filter === "all" ? items
        : filter === "unresolved" ? items.filter(f => !f.resolved)
        : items.filter(f => f.resolved);
      setFlags(filtered);
    } catch (err) {
      setError(err.message || "Failed to load flags.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(action) {
    if (!selectedFlag) return;

    // Confirm destructive actions
    if (ACTION_CONFIG[action].confirm && confirmAction !== action) {
      setConfirmAction(action);
      return;
    }

    setResolving(true);
    setFeedback("");
    try {
      await resolveFlagFn({
        flagId: selectedFlag.id,
        action,
        notes: resolveNotes.trim() || undefined,
      });

      setFeedback(`✓ Flag ${action === "dismiss" ? "dismissed" : action === "warn" ? "resolved — user warned" : "resolved — user banned"}`);
      setConfirmAction(null);
      setResolveNotes("");

      // Remove from list
      setFlags(prev => prev.filter(f => f.id !== selectedFlag.id));
      setSelectedFlag(null);

    } catch (err) {
      setFeedback(`✗ ${err.message}`);
    } finally {
      setResolving(false);
    }
  }

  const unresolvedCount = flags.filter(f => !f.resolved).length;

  if (loading) return <AdminLoading label="Loading flags..." />;
  if (error)   return <AdminError error={error} onRetry={loadFlags} />;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">
            Flags
            {unresolvedCount > 0 && filter === "unresolved" && (
              <span className="admin-page-badge">{unresolvedCount}</span>
            )}
          </h1>
          <p className="admin-page-sub">Review reported users and submissions</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="admin-filter-tabs">
        {["unresolved", "resolved", "all"].map(f => (
          <button
            key={f}
            className={`admin-filter-tab ${filter === f ? "admin-filter-tab--active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {flags.length === 0 ? (
        <div className="admin-flags-empty">
          <span className="admin-empty-icon">⚑</span>
          <p>No {filter === "all" ? "" : filter} flags.</p>
        </div>
      ) : (
        <div className="admin-flags-layout">

          {/* Flag list */}
          <div className="admin-flags-list">
            {flags.map(flag => (
              <div
                key={flag.id}
                className={`admin-flag-row ${selectedFlag?.id === flag.id ? "admin-flag-row--selected" : ""} ${flag.resolved ? "admin-flag-row--resolved" : ""}`}
                onClick={() => { setSelectedFlag(flag); setFeedback(""); setConfirmAction(null); setResolveNotes(""); }}
              >
                <div className="admin-flag-row-top">
                  <span className="admin-flag-reported">
                    <span className="admin-flag-user-icon">⊙</span>
                    {flag.reportedUsername}
                  </span>
                  <span className={`admin-chip ${flag.resolved ? "admin-chip--ok" : "admin-chip--flagged"}`}>
                    {flag.resolved ? "Resolved" : "Open"}
                  </span>
                </div>
                <div className="admin-flag-reason">{flag.reason || "No reason provided"}</div>
                <div className="admin-flag-meta">
                  Reported by {flag.reportedByUsername}
                  {" · "}
                  {flag.createdAt?.toDate
                    ? formatRelative(flag.createdAt.toDate())
                    : "Unknown time"
                  }
                </div>
              </div>
            ))}
          </div>

          {/* Flag detail */}
          {selectedFlag ? (
            <div className="admin-flag-detail">
              <div className="admin-detail-header">
                <span className="admin-detail-username">
                  Flag: {selectedFlag.reportedUsername}
                </span>
                <span className="admin-detail-id">{selectedFlag.id}</span>
              </div>

              <div className="admin-flag-detail-body">
                <div className="admin-kv-row">
                  <span className="admin-kv-label">Reported user</span>
                  <span className="admin-kv-value admin-kv-value--mono">{selectedFlag.reportedUsername}</span>
                </div>
                <div className="admin-kv-row">
                  <span className="admin-kv-label">Reported by</span>
                  <span className="admin-kv-value admin-kv-value--mono">{selectedFlag.reportedByUsername}</span>
                </div>
                <div className="admin-kv-row">
                  <span className="admin-kv-label">Type</span>
                  <span className="admin-kv-value">{selectedFlag.type || "Manual"}</span>
                </div>
                {selectedFlag.contestTitle && (
                  <div className="admin-kv-row">
                    <span className="admin-kv-label">Contest</span>
                    <span className="admin-kv-value">{selectedFlag.contestTitle}</span>
                  </div>
                )}
                {selectedFlag.details && (
                  <div className="admin-kv-row">
                    <span className="admin-kv-label">Details</span>
                    <span className="admin-kv-value" style={{ color: "var(--color-warning)" }}>{selectedFlag.details}</span>
                  </div>
                )}
                <div className="admin-kv-row">
                  <span className="admin-kv-label">Warnings</span>
                  <span className="admin-kv-value">{selectedFlag.warningCount || 0}</span>
                </div>
              </div>

              <div className="admin-flag-reason-full">
                <span className="admin-detail-section-label">Reason</span>
                <p>{selectedFlag.reason || "No reason provided."}</p>
              </div>

              {!selectedFlag.resolved && (
                <>
                  <div className="admin-detail-section">
                    <span className="admin-detail-section-label">Admin Notes (optional)</span>
                    <textarea
                      className="admin-textarea"
                      placeholder="Add notes about this resolution..."
                      value={resolveNotes}
                      onChange={e => setResolveNotes(e.target.value)}
                      rows={3}
                    />
                  </div>

                  {feedback && (
                    <div className={`admin-action-msg ${feedback.startsWith("✓") ? "admin-action-msg--ok" : "admin-action-msg--err"}`}>
                      {feedback}
                    </div>
                  )}

                  <div className="admin-flag-actions">
                    {Object.entries(ACTION_CONFIG).map(([action, cfg]) => (
                      <button
                        key={action}
                        className="admin-flag-action-btn"
                        style={{ color: cfg.color, background: confirmAction === action ? cfg.bg : undefined }}
                        onClick={() => handleResolve(action)}
                        disabled={resolving}
                      >
                        {resolving && confirmAction === action
                          ? "Processing..."
                          : confirmAction === action
                            ? `Confirm ${cfg.label}`
                            : cfg.label
                        }
                      </button>
                    ))}
                    {confirmAction && (
                      <button
                        className="admin-flag-action-btn"
                        onClick={() => setConfirmAction(null)}
                        disabled={resolving}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </>
              )}

              {selectedFlag.resolved && (
                <div className="admin-flag-resolved-note">
                  <span>✓</span> This flag has been resolved.
                  {selectedFlag.resolvedAt?.toDate && (
                    <span> ({formatRelative(selectedFlag.resolvedAt.toDate())})</span>
                  )}
                </div>
              )}

            </div>
          ) : (
            <div className="admin-flag-detail admin-user-detail--empty">
              <span className="admin-empty-icon">⚑</span>
              <p>Select a flag to review</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatRelative(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}