/**
 * NotificationBell.jsx
 * Bell icon with unread badge + dropdown panel showing recent notifications.
 * Subscribes to notifications/{userId}/items in real-time.
 *
 * File location: frontend/src/components/layout/NotificationBell.jsx
 */
import { useState, useEffect, useRef } from "react";
import {
  collection, query, orderBy, limit,
  onSnapshot, doc, updateDoc, writeBatch, deleteDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { useAuth } from "../../context/AuthContext";

export default function NotificationBell() {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [open, setOpen]                   = useState(false);
  const [showAll, setShowAll]             = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Subscribe to latest 30 notifications
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, "notifications", currentUser.uid, "items"),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setNotifications(items);
      setUnreadCount(items.filter(n => !n.read).length);
    });
    return unsub;
  }, [currentUser?.uid]);

  // Auto-mark all as read when dropdown is opened
  useEffect(() => {
    if (open && currentUser?.uid) {
      const unread = notifications.filter(n => !n.read);
      if (unread.length === 0) return;
      const batch = writeBatch(db);
      unread.forEach(n => {
        batch.update(
          doc(db, "notifications", currentUser.uid, "items", n.id),
          { read: true }
        );
      });
      batch.commit().catch(console.error);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function dismissOne(e, notifId) {
    e.stopPropagation();
    if (!currentUser?.uid) return;
    await deleteDoc(
      doc(db, "notifications", currentUser.uid, "items", notifId)
    );
  }

  async function dismissAll() {
    if (!currentUser?.uid) return;
    const batch = writeBatch(db);
    notifications.forEach(n => {
      batch.delete(doc(db, "notifications", currentUser.uid, "items", n.id));
    });
    await batch.commit();
    setShowAll(false);
  }

  function handleNotifClick(n) {
    if (n.link) {
      window.location.href = n.link;
    }
  }

  function formatTimeAgo(ts) {
    if (!ts) return "";
    const ms = ts.toMillis ? ts.toMillis() : ts;
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return "Just now";
  }

  const ICON_MAP = {
    contest_result:   "ðŸ†",
    contest_reminder: "â°",
    badge:            "ðŸŽ–",
    certificate:      "ðŸ“œ",
    admin:            "ðŸ“¢",
    flag_warning:     "âš ",
    elo_change:       "âš¡",
    system:           "ðŸ””",
  };

  // Only show unread by default; "show all" reveals everything
  const displayed = showAll ? notifications : notifications.filter(n => !n.read);
  const readCount = notifications.filter(n => n.read).length;

  return (
    <div className="notif-bell-wrap" ref={ref}>
      <button
        className="notif-bell-btn"
        onClick={() => { setOpen(v => !v); setShowAll(false); }}
        title="Notifications"
        style={{
          position: "relative", display: "flex", alignItems: "center",
          justifyContent: "center", background: "none", border: "none",
          cursor: "pointer", padding: 6, borderRadius: 8, color: "var(--color-text-muted)",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2,
            background: "var(--color-error)", color: "#fff",
            borderRadius: "50%", width: 16, height: 16,
            fontSize: 10, fontWeight: 700, display: "flex",
            alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-mono)",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0, width: 320,
          maxHeight: 420, overflowY: "auto",
          background: "var(--color-bg)", border: "1px solid var(--color-border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          zIndex: 1000, fontFamily: "var(--font-mono)",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 16px", borderBottom: "1px solid var(--color-border)",
            position: "sticky", top: 0, background: "var(--color-bg)", zIndex: 1,
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{
                  marginLeft: 6, background: "var(--color-error)", color: "#fff",
                  borderRadius: 99, padding: "1px 6px", fontSize: 10, fontWeight: 700,
                }}>
                  {unreadCount} new
                </span>
              )}
            </span>
            {notifications.length > 0 && (
              <button
                onClick={dismissAll}
                style={{
                  background: "none", border: "none", color: "var(--color-text-subtle)",
                  fontSize: 11, cursor: "pointer", fontFamily: "var(--font-mono)",
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* List */}
          {displayed.length === 0 && !showAll ? (
            <div style={{ padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>ðŸŽ‰</div>
              <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                You're all caught up!
              </div>
              {readCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  style={{
                    marginTop: 8, background: "none", border: "none",
                    color: "var(--color-accent)", fontSize: 11,
                    cursor: "pointer", fontFamily: "var(--font-mono)",
                  }}
                >
                  Show {readCount} older notification{readCount !== 1 ? "s" : ""}
                </button>
              )}
            </div>
          ) : (
            <>
              {displayed.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  style={{
                    display: "flex", gap: 10, padding: "10px 16px",
                    borderBottom: "1px solid var(--color-border-subtle)",
                    background: n.read ? "transparent" : "rgba(0,255,136,0.04)",
                    cursor: n.link ? "pointer" : "default",
                    transition: "background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                    {ICON_MAP[n.type] || "ðŸ””"}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, color: "var(--color-text)",
                      fontWeight: n.read ? 400 : 600, lineHeight: 1.4,
                    }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{
                        fontSize: 11, color: "var(--color-text-muted)",
                        marginTop: 2, lineHeight: 1.3,
                      }}>
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "var(--color-text-subtle)", marginTop: 3 }}>
                      {formatTimeAgo(n.createdAt)}
                    </div>
                  </div>
                  {/* Dismiss button */}
                  <button
                    onClick={(e) => dismissOne(e, n.id)}
                    title="Dismiss"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--color-text-subtle)", fontSize: 14, padding: "0 2px",
                      flexShrink: 0, lineHeight: 1, alignSelf: "flex-start",
                      opacity: 0.5,
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}
                  >
                    âœ•
                  </button>
                </div>
              ))}

              {/* Toggle older */}
              {!showAll && readCount > 0 && (
                <button
                  onClick={() => setShowAll(true)}
                  style={{
                    width: "100%", padding: "10px 16px", background: "none", border: "none",
                    borderTop: "1px solid var(--color-border-subtle)",
                    color: "var(--color-accent)", fontSize: 11, cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Show {readCount} older notification{readCount !== 1 ? "s" : ""}
                </button>
              )}
              {showAll && (
                <button
                  onClick={() => setShowAll(false)}
                  style={{
                    width: "100%", padding: "10px 16px", background: "none", border: "none",
                    borderTop: "1px solid var(--color-border-subtle)",
                    color: "var(--color-text-subtle)", fontSize: 11, cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Show unread only
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
