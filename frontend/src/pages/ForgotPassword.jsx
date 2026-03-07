/**
 * ForgotPassword.jsx
 * Sends a password reset email via Firebase Auth.
 *
 * File location: frontend/src/pages/ForgotPassword.jsx
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Auth.css";

export default function ForgotPassword() {
  const { resetPassword } = useAuth();

  const [email, setEmail]     = useState("");
  const [error, setError]     = useState("");
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      // Don't reveal whether email exists — security best practice
      // Show success regardless to prevent email enumeration
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg-grid" aria-hidden="true" />
      <div className="auth-glow" aria-hidden="true" />

      <div className="auth-card">

        <div className="auth-logo">
          <span className="auth-logo-bracket">[</span>
          <span className="auth-logo-text">PWNGRID</span>
          <span className="auth-logo-bracket">]</span>
        </div>

        {!sent ? (
          <>
            <h1 className="auth-title">Reset password</h1>
            <p className="auth-subtitle">
              Enter your email and we&apos;ll send a reset link.
            </p>

            {error && (
              <div className="auth-error" role="alert">
                <span className="auth-error-icon">⚠</span>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              <div className="auth-field">
                <label htmlFor="email" className="auth-label">Email</label>
                <input
                  id="email"
                  type="email"
                  className="auth-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  disabled={loading}
                />
              </div>

              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? (
                  <span className="auth-btn-loading">
                    <span className="auth-btn-spinner" />
                    Sending...
                  </span>
                ) : (
                  "Send reset link →"
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="auth-verify-icon" aria-hidden="true">✓</div>
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-subtitle">
              If an account exists for <strong>{email}</strong>, a password reset link has been sent.
            </p>
            <p className="auth-verify-instruction">
              Check your spam folder if you don&apos;t see it within a few minutes.
            </p>
          </>
        )}

        <p className="auth-footer">
          <Link to="/login" className="auth-footer-link">← Back to sign in</Link>
        </p>

      </div>
    </div>
  );
}