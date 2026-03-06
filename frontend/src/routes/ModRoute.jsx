/**
 * ModRoute.jsx
 * Protects routes accessible to both moderators AND admins.
 * File location: frontend/src/routes/ModRoute.jsx
 */
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Spinner from "../components/ui/Spinner";

export default function ModRoute({ children }) {
  const { isAuthenticated, isVerified, isMod, isContestMod, loading, profileLoading } = useAuth();
  const location = useLocation();

  if (loading || profileLoading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#0d0f12" }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated || !isVerified) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isMod && !isContestMod) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}