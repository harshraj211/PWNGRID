/**
 * AdminRoute.jsx
 * Requires: authenticated + verified + role === "admin"
 * Redirects:
 *   - Not logged in  → /login
 *   - Not admin      → /dashboard (silent redirect, no error message exposed)
 *
 * File location: frontend/src/routes/AdminRoute.jsx
 */

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Spinner from "../components/ui/Spinner";

export default function AdminRoute({ children }) {
  const { isAuthenticated, isVerified, isAdmin, loading, profileLoading } = useAuth();
  const location = useLocation();

  // Wait for both auth AND profile to load (role comes from Firestore profile)
  if (loading || profileLoading) {
    return (
      <div className="route-loading">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  if (!isAdmin) {
    // SECURITY: Return 404 — don't hint that /admin exists but is restricted.
    // A redirect to /dashboard signals "route exists, access denied" to attackers.
    return <Navigate to="/404" replace />;
  }

  return children;
}