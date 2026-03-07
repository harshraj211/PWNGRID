/**
 * AdminBroadcast.jsx
 * Send important notifications to all users (or a filtered audience).
 * Calls the sendAdminNotification Cloud Function.
 *
 * File location: frontend/src/pages/admin/AdminBroadcast.jsx
 */

import { useState } from "react";
import { functions } from "../../firebase/config";
import { httpsCallable } from "firebase/functions";
import "./Admin.css";

const sendAdminNotificationFn = httpsCallable(functions, "sendAdminNotification");

const TYPE_OPTIONS = [
  { value: "admin",            label: "📢 General Announcement",  desc: "Platform-wide updates, maintenance, policy changes" },
  { value: "contest_reminder", label: "🏆 Contest",               desc: "New contest, registration open, results published" },
  { value: "system",           label: "⚙ System",                desc: "Bug fixes, new features, downtime" },
  { value: "badge",            label: "🏅 Offer / Promotion",    desc: "Discount codes, Pro upgrade offers, events" },
  { value: "elo_change",       label: "⚡ ELO / Leaderboard",    desc: "Season reset, rank changes, new challenges" },
];

const AUDIENCE_OPTIONS = [
  { value: "all",  label: "All users",  desc: "Every registered user" },
  { value: "pro",  label: "Pro users",  desc: "Only users with Pro plan" },
  { value: "free", label: "Free users", desc: "Only users on free plan" },
];

export default function AdminBroadcast() {
  const [type,     setType]     = useState("admin");
  const [title,    setTitle]    = useState("");
  const [body,     setBody]     = useState("");
  const [link,     setLink]     = useState("");
  const [audience, setAudience] = useState("all");

  const [sending,  setSending]  = useState(false);
  const [feedback, setFeedback] = useState(null); // { ok: bool, msg: string, count?: number }
  const [confirm,  setConfirm]  = useState(false);

  const selectedType = TYPE_OPTIONS.find(t => t.value === type);

  function handleSendClick(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setConfirm(true);
  }

  async function handleConfirm() {
    setSending(true);
    setFeedback(null);
    setConfirm(false);
    try {
      const res = await sendAdminNotificationFn({
        title:    title.trim(),
        body:     body.trim() || undefined,
        type,
        link:     link.trim() || undefined,
        audience,
      });
      const count = res.data?.count ?? 0;
      setFeedback({ ok: true, msg: `✓ Sent to ${count} user${count !== 1 ? "s" : ""}.` });
      // Clear form on success
      setTitle("");
      setBody("");
      setLink("");
    } catch (err) {
      setFeedback({ ok: false, msg: `✗ ${err.message || "Failed to send notification."}` });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Broadcast</h1>
          <p className="admin-page-sub">Send an important notification to users</p>
        </div>
      </div>

      <div className="admin-broadcast-layout">

        {/* ── Compose form ─────────────────────────────────────────────── */}
        <form className="admin-broadcast-form" onSubmit={handleSendClick}>

          {/* Type */}
          <label className="admin-field-label">Notification Type</label>
          <div className="admin-broadcast-types">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`admin-broadcast-type-btn ${type === opt.value ? "admin-broadcast-type-btn--active" : ""}`}
                onClick={() => setType(opt.value)}
              >
                <span className="admin-broadcast-type-label">{opt.label}</span>
                <span className="admin-broadcast-type-desc">{opt.desc}</span>
              </button>
            ))}
          </div>

          {/* Audience */}
          <label className="admin-field-label" style={{ marginTop: 20 }}>Audience</label>
          <div className="admin-broadcast-audience">
            {AUDIENCE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`admin-broadcast-audience-btn ${audience === opt.value ? "admin-broadcast-audience-btn--active" : ""}`}
                onClick={() => setAudience(opt.value)}
              >
                <span className="admin-broadcast-audience-label">{opt.label}</span>
                <span className="admin-broadcast-audience-desc">{opt.desc}</span>
              </button>
            ))}
          </div>

          {/* Title */}
          <label className="admin-field-label" style={{ marginTop: 20 }}>
            Title <span style={{ color: "var(--color-error)" }}>*</span>
          </label>
          <input
            type="text"
            className="admin-input"
            placeholder="e.g. New Contest: OSINT Championship 2026 is live!"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={120}
            required
          />
          <span className="admin-field-hint">{title.length}/120</span>

          {/* Body */}
          <label className="admin-field-label" style={{ marginTop: 16 }}>Message (optional)</label>
          <textarea
            className="admin-textarea"
            placeholder="Additional details shown in the notification drawer..."
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={3}
            maxLength={500}
          />
          <span className="admin-field-hint">{body.length}/500</span>

          {/* Link */}
          <label className="admin-field-label" style={{ marginTop: 16 }}>Link (optional)</label>
          <input
            type="text"
            className="admin-input"
            placeholder="e.g. /contests  or  /pricing"
            value={link}
            onChange={e => setLink(e.target.value)}
          />
          <span className="admin-field-hint">Frontend path or full URL. Users can click the notification to navigate here.</span>

          {feedback && (
            <div
              className={`admin-action-msg ${feedback.ok ? "admin-action-msg--ok" : "admin-action-msg--err"}`}
              style={{ marginTop: 16 }}
            >
              {feedback.msg}
            </div>
          )}

          {!confirm ? (
            <button
              type="submit"
              className="admin-broadcast-send-btn"
              disabled={!title.trim() || sending}
              style={{ marginTop: 20 }}
            >
              {sending ? "Sending…" : "📤 Send Notification"}
            </button>
          ) : (
            <div className="admin-broadcast-confirm-box">
              <p className="admin-broadcast-confirm-msg">
                Send &quot;<strong>{title}</strong>&quot; to <strong>{AUDIENCE_OPTIONS.find(a => a.value === audience)?.label}</strong>?
                This cannot be undone.
              </p>
              <div className="admin-btn-group">
                <button
                  type="button"
                  className="admin-broadcast-send-btn"
                  onClick={handleConfirm}
                  disabled={sending}
                >
                  {sending ? "Sending…" : "✓ Confirm Send"}
                </button>
                <button
                  type="button"
                  className="admin-refresh-btn"
                  onClick={() => setConfirm(false)}
                  disabled={sending}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>

        {/* ── Live preview ─────────────────────────────────────────────── */}
        <div className="admin-broadcast-preview-panel">
          <div className="admin-field-label" style={{ marginBottom: 12 }}>Preview</div>
          <div className="admin-broadcast-preview-notif">
            <div className="admin-broadcast-preview-icon">
              {selectedType?.label.split(" ")[0] || "📢"}
            </div>
            <div className="admin-broadcast-preview-content">
              <div className="admin-broadcast-preview-title">
                {title || <span style={{ opacity: 0.35 }}>Notification title…</span>}
              </div>
              {body && (
                <div className="admin-broadcast-preview-body">{body}</div>
              )}
              {link && (
                <div className="admin-broadcast-preview-link">→ {link}</div>
              )}
              <div className="admin-broadcast-preview-meta">
                {selectedType?.label} · just now · {AUDIENCE_OPTIONS.find(a => a.value === audience)?.label}
              </div>
            </div>
          </div>

          <div className="admin-broadcast-tips">
            <div className="admin-field-label" style={{ marginBottom: 8 }}>Tips</div>
            <ul className="admin-broadcast-tips-list">
              <li>Keep titles under 80 chars so they don&apos;t get truncated on mobile.</li>
              <li>Use the link field to direct users to contests, pricing, or challenges.</li>
              <li>Notifications appear in the bell icon in the top nav bar.</li>
              <li>Use &quot;Pro users&quot; audience for upgrade offers, &quot;Free users&quot; for conversion campaigns.</li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
