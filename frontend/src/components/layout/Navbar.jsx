/**
 * Navbar.jsx — v2 with SVG icons (TryHackMe style)
 * File location: frontend/src/components/layout/Navbar.jsx
 */
import { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import NotificationBell from "./NotificationBell";
import "./Navbar.css";

// ── SVG Icon set ──────────────────────────────────────────────────────────────
const Icons = {
  Dashboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  Challenges: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  Leaderboard: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="14" width="5" height="8" rx="1"/><rect x="9.5" y="9" width="5" height="13" rx="1"/>
      <rect x="17" y="4" width="5" height="18" rx="1"/>
    </svg>
  ),
  Contests: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 21h8"/><path d="M12 21v-4"/><path d="M7 4H4v6a8 8 0 0016 0V4h-3"/>
      <path d="M7 4h10"/>
    </svg>
  ),
  Admin: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1l3 6 6.5 1-4.7 4.6 1.1 6.5L12 16l-5.9 3.1 1.1-6.5L2.5 8 9 7z"/>
    </svg>
  ),
  ELO: () => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  ),
  Streak: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.5 2C10 6 14 10 11 14c-1-3-4-4-4-8C4.5 8.5 3 13 5 17a8 8 0 0016 0c0-6-4-10-7.5-15z"/>
    </svg>
  ),
  Profile: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  ),
  Signout: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Upgrade: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17,11 12,6 7,11"/><line x1="12" y1="6" x2="12" y2="18"/>
    </svg>
  ),
};

export default function Navbar() {
  const { currentUser, userProfile, isAdmin, isMod, isContestMod, isPro, logout } = useAuth();
  const navigate = useNavigate();

  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") ||
    localStorage.getItem("osint-theme") ||
    "dark"
  );

  const [menuOpen,    setMenuOpen]    = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("osint-theme", next);
  }

  async function handleLogout() {
    setProfileOpen(false);
    await logout();
    navigate("/login");
  }

  const elo      = userProfile?.elo ?? 0;
  const streak   = userProfile?.currentStreak ?? 0;
  const username = userProfile?.username ?? currentUser?.email?.split("@")[0] ?? "Analyst";
  const avatarLetter = username.charAt(0).toUpperCase();
  const userRole = userProfile?.role || "user";
  const roleLabel = userRole === "admin" ? "Admin" : userRole === "mod" ? "Mod" : userRole === "contest_mod" ? "Contest Mod" : null;

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar-inner">

        {/* ── Logo ───────────────────────────────────────────────────── */}
        <Link to="/dashboard" className="navbar-logo">
          <div className="navbar-logo-icon">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="15" stroke="var(--color-accent)" strokeWidth="1.5"/>
              <circle cx="16" cy="16" r="6" fill="var(--color-accent)" opacity="0.2"/>
              <circle cx="16" cy="16" r="3" fill="var(--color-accent)"/>
              <line x1="16" y1="1" x2="16" y2="8" stroke="var(--color-accent)" strokeWidth="1.5"/>
              <line x1="16" y1="24" x2="16" y2="31" stroke="var(--color-accent)" strokeWidth="1.5"/>
              <line x1="1" y1="16" x2="8" y2="16" stroke="var(--color-accent)" strokeWidth="1.5"/>
              <line x1="24" y1="16" x2="31" y2="16" stroke="var(--color-accent)" strokeWidth="1.5"/>
            </svg>
          </div>
          <div className="navbar-logo-text-group">
            <span className="navbar-logo-main">OSINT</span>
            <span className="navbar-logo-sub">ARENA</span>
          </div>
        </Link>

        {/* ── Nav links ──────────────────────────────────────────────── */}
        <div className="navbar-links">
          <NavLink to="/dashboard" className={({isActive})=>`navbar-link ${isActive?"navbar-link--active":""}`}>
            <Icons.Dashboard /><span>Dashboard</span>
          </NavLink>
          <NavLink to="/challenges" className={({isActive})=>`navbar-link ${isActive?"navbar-link--active":""}`}>
            <Icons.Challenges /><span>Challenges</span>
          </NavLink>
          <NavLink to="/leaderboard" className={({isActive})=>`navbar-link ${isActive?"navbar-link--active":""}`}>
            <Icons.Leaderboard /><span>Leaderboard</span>
          </NavLink>
          <NavLink to="/contests" className={({isActive})=>`navbar-link ${isActive?"navbar-link--active":""}`}>
            <Icons.Contests />
            <span>Contests</span>
          </NavLink>
          {(isAdmin || isMod || isContestMod) && (
            <NavLink to="/admin" className={({isActive})=>`navbar-link navbar-link--admin ${isActive?"navbar-link--active":""}`}>
              <Icons.Admin /><span>{userRole === "admin" ? "Admin" : userRole === "mod" ? "Mod" : "Contest Mod"}</span>
            </NavLink>
          )}
        </div>

        {/* ── Right side ─────────────────────────────────────────────── */}
        <div className="navbar-right">

          {/* Notification bell */}
          {currentUser && (
            <NotificationBell />
          )}

          {/* Streak chip */}
          {streak > 0 && (
            <div className="navbar-streak" title={`${streak} day streak`}>
              <span className="navbar-streak-icon"><Icons.Streak /></span>
              <span className="navbar-streak-value">{streak}</span>
            </div>
          )}

          {/* Theme toggle */}
          <button
            className="navbar-theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>

          {/* ELO chip */}
          <div className="navbar-elo" title="Global ELO">
            <span className="navbar-elo-icon"><Icons.ELO /></span>
            <span className="navbar-elo-value">{elo.toLocaleString()}</span>
          </div>

          {/* Upgrade button */}
          {!isPro && (
            <Link to="/pricing" className="navbar-upgrade-btn">
              <Icons.Upgrade />
              <span>Upgrade</span>
            </Link>
          )}

          {/* Profile dropdown */}
          <div className="navbar-profile" ref={profileRef}>
            <button className="navbar-avatar-btn"
              onClick={() => setProfileOpen(v => !v)}
              aria-expanded={profileOpen}>
              <div className="navbar-avatar-circle">{avatarLetter}</div>
              <span className="navbar-username">{username}</span>
              <svg className={`navbar-chevron ${profileOpen?"navbar-chevron--open":""}`}
                width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
                <polyline points="2,4 6,8 10,4"/>
              </svg>
            </button>

            {profileOpen && (
              <div className="navbar-dropdown">
                <div className="navbar-dropdown-header">
                  <div className="navbar-dropdown-avatar">{avatarLetter}</div>
                  <div>
                    <div className="navbar-dropdown-username">{username}</div>
                    <div className="navbar-dropdown-plan">
                      {isPro ? <span className="navbar-plan-pro">PRO</span> : <span className="navbar-plan-free">FREE</span>}
                    </div>
                  </div>
                </div>
                <div className="navbar-dropdown-divider"/>
                <Link to="/profile" className="navbar-dropdown-item" onClick={()=>setProfileOpen(false)}>
                  <Icons.Profile /><span>My Profile</span>
                </Link>
                <Link to="/dashboard" className="navbar-dropdown-item" onClick={()=>setProfileOpen(false)}>
                  <Icons.Dashboard /><span>Dashboard</span>
                </Link>
                {!isPro && (
                  <Link to="/pricing" className="navbar-dropdown-item navbar-dropdown-item--accent" onClick={()=>setProfileOpen(false)}>
                    <Icons.Upgrade /><span>Upgrade to Pro</span>
                  </Link>
                )}
                <div className="navbar-dropdown-divider"/>
                <button className="navbar-dropdown-item navbar-dropdown-item--danger" onClick={handleLogout}>
                  <Icons.Signout /><span>Sign out</span>
                </button>
              </div>
            )}
          </div>

          {/* Hamburger */}
          <button className={`navbar-hamburger ${menuOpen?"navbar-hamburger--open":""}`}
            onClick={()=>setMenuOpen(v=>!v)} aria-label="Toggle menu">
            <span/><span/><span/>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="navbar-mobile">
          <NavLink to="/dashboard"  className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}><Icons.Dashboard /><span>Dashboard</span></NavLink>
          <NavLink to="/challenges" className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}><Icons.Challenges /><span>Challenges</span></NavLink>
          <NavLink to="/leaderboard" className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}><Icons.Leaderboard /><span>Leaderboard</span></NavLink>
          <NavLink to="/contests"   className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}>
            <Icons.Contests /><span>Contests</span>{!isPro && <span className="navbar-pro-badge">PRO</span>}
          </NavLink>
          {(isAdmin || isContestMod) && <NavLink to="/admin" className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}><Icons.Admin /><span>Admin</span></NavLink>}
          <div className="navbar-mobile-divider"/>
          <NavLink to="/profile" className="navbar-mobile-link" onClick={()=>setMenuOpen(false)}><Icons.Profile /><span>My Profile</span></NavLink>
          <button className="navbar-mobile-link navbar-mobile-link--danger" onClick={handleLogout}><Icons.Signout /><span>Sign out</span></button>
        </div>
      )}
    </nav>
  );
}