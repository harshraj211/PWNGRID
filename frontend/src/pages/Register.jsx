/**
 * Register.jsx — v2 with Google Sign-In
 * File location: frontend/src/pages/Register.jsx
 */
import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Auth.css";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

function getPasswordStrength(p) {
  let score = 0;
  if (p.length >= 8)  score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  if (score <= 1) return { label: "Weak",   color: "var(--color-hard)",   width: "20%" };
  if (score <= 2) return { label: "Fair",   color: "var(--color-warning)", width: "40%" };
  if (score <= 3) return { label: "Good",   color: "var(--color-warning)", width: "65%" };
  if (score <= 4) return { label: "Strong", color: "var(--color-accent)",  width: "85%" };
  return { label: "Very Strong", color: "var(--color-accent)", width: "100%" };
}

export default function Register() {
  const { register, loginWithGoogle, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already signed in (handles Google redirect return)
  useEffect(() => {
    if (!authLoading && isAuthenticated) navigate("/dashboard", { replace: true });
  }, [isAuthenticated, authLoading, navigate]);

  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const strength = getPasswordStrength(password);

  if (!authLoading && isAuthenticated) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!USERNAME_REGEX.test(username.trim())) {
      setError("Username must be 3-20 chars, letters/numbers/underscores only."); return;
    }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      await register(email.trim(), password, username.trim());
      navigate("/verify-email");
    } catch (err) {
      setError(getFriendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setGLoading(true);
    try {
      await loginWithGoogle(); // triggers redirect — page navigates away
    } catch (err) {
      setError(getFriendlyError(err.code));
      setGLoading(false);
    }
    // setGLoading(false) intentionally skipped — page will redirect away
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">[ PWNGRID ]</div>
        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">Join the intelligence community.</p>

        {error && <div className="auth-error">⚠ {error}</div>}

        <button className="auth-google-btn" onClick={handleGoogle} disabled={gLoading || loading}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {gLoading ? "Signing up..." : "Continue with Google"}
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input className="auth-input" type="text" value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="agent_zero" autoComplete="username" />
            <span className="auth-hint">3-20 chars · letters, numbers, underscores</span>
          </div>

          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input className="auth-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="agent@example.com" autoComplete="email" />
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <input className="auth-input" type={showPass ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" />
              <button type="button" className="auth-show-btn" onClick={() => setShowPass(p => !p)}>
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
            {password && (
              <div className="auth-strength">
                <div className="auth-strength-bar">
                  <div className="auth-strength-fill"
                    style={{ width: strength.width, background: strength.color }} />
                </div>
                <span style={{ color: strength.color }}>{strength.label}</span>
              </div>
            )}
          </div>

          <div className="auth-field">
            <label className="auth-label">Confirm password</label>
            <input className="auth-input" type={showPass ? "text" : "password"}
              value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="••••••••" autoComplete="new-password" />
          </div>

          <button className="auth-submit-btn" type="submit" disabled={loading || gLoading}>
            {loading ? "Creating account..." : "Create account →"}
          </button>
        </form>

        <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}

function getFriendlyError(code) {
  const map = {
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-email":        "Please enter a valid email address.",
    "auth/weak-password":        "Password must be at least 6 characters.",
    "auth/too-many-requests":    "Too many attempts. Please try again later.",
  };
  return map[code] || "Something went wrong. Please try again.";
}