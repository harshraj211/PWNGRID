/**
 * AppRouter.jsx — v2
 * Added: AdminChallenges, ModRoute (admin + moderator access)
 * File location: frontend/src/routes/AppRouter.jsx
 */
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "../context/AuthContext";
import Spinner from "../components/ui/Spinner";

const Login            = lazy(() => import("../pages/Login"));
const Register         = lazy(() => import("../pages/Register"));
const VerifyEmail      = lazy(() => import("../pages/VerifyEmail"));
const ForgotPassword   = lazy(() => import("../pages/ForgotPassword"));
const Pricing          = lazy(() => import("../pages/Pricing"));
const CertVerify       = lazy(() => import("../pages/CertVerify"));
const NotFound         = lazy(() => import("../pages/NotFound"));
const Dashboard        = lazy(() => import("../pages/Dashboard"));
const Challenges       = lazy(() => import("../pages/Challenges"));
const ChallengeSolve          = lazy(() => import("../pages/ChallengeSolve"));
const InvestigationChallenge  = lazy(() => import("../pages/InvestigationChallenge"));
const Profile          = lazy(() => import("../pages/Profile"));
const EditProfile      = lazy(() => import("../pages/EditProfile"));
const Leaderboard      = lazy(() => import("../pages/Leaderboard"));
const Contests         = lazy(() => import("../pages/Contests"));
const ContestSolve     = lazy(() => import("../pages/ContestSolve"));
const AdminLayout      = lazy(() => import("../pages/admin/AdminLayout"));
const AdminDashboard   = lazy(() => import("../pages/admin/AdminDashboard"));
const AdminUsers       = lazy(() => import("../pages/admin/AdminUsers"));
const AdminFlags       = lazy(() => import("../pages/admin/AdminFlags"));
const AdminChallenges  = lazy(() => import("../pages/admin/AdminChallenges"));
const AdminAnalytics   = lazy(() => import("../pages/admin/AdminAnalytics"));
const AdminContests    = lazy(() => import("../pages/admin/AdminContests"));
const AdminBroadcast   = lazy(() => import("../pages/admin/AdminBroadcast"));

import PrivateRoute from "./PrivateRoute";
import ProRoute     from "./ProRoute";
import AdminRoute   from "./AdminRoute";
import ModRoute     from "./ModRoute";

function PageLoader() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#0d0f12" }}>
      <Spinner size="lg" />
    </div>
  );
}

function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <PageLoader />;
  return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}

function AdminIndexRedirect() {
  const { userProfile } = useAuth();
  const role = userProfile?.role || "user";
  if (role === "contest_mod") return <Navigate to="/admin/contests" replace />;
  return <Navigate to="/admin/dashboard" replace />;
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"               element={<RootRedirect />} />
          <Route path="/login"          element={<Login />} />
          <Route path="/register"       element={<Register />} />
          <Route path="/verify-email"   element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/pricing"        element={<Pricing />} />
          <Route path="/verify/:certId" element={<CertVerify />} />

          <Route path="/dashboard"      element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/challenges"     element={<PrivateRoute><Challenges /></PrivateRoute>} />
          <Route path="/challenges/:slug" element={<PrivateRoute><ChallengeSolve /></PrivateRoute>} />
          <Route path="/investigate/:challengeId" element={<PrivateRoute><InvestigationChallenge /></PrivateRoute>} />
          <Route path="/profile"        element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/profile/edit"   element={<PrivateRoute><EditProfile /></PrivateRoute>} />
          <Route path="/profile/:username" element={<PrivateRoute><Profile /></PrivateRoute>} />
          <Route path="/leaderboard"    element={<PrivateRoute><Leaderboard /></PrivateRoute>} />

          <Route path="/contests"           element={<PrivateRoute><Contests /></PrivateRoute>} />
          <Route path="/contests/:contestId" element={<PrivateRoute><ContestSolve /></PrivateRoute>} />

          {/* Admin panel — accessible to admin + moderator */}
          <Route path="/admin" element={<ModRoute><AdminLayout /></ModRoute>}>
            <Route index element={<AdminIndexRedirect />} />
            <Route path="dashboard"  element={<AdminDashboard />} />
            <Route path="analytics"  element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
            <Route path="challenges" element={<AdminChallenges />} />
            <Route path="contests"   element={<AdminContests />} />
            <Route path="users"      element={<AdminRoute><AdminUsers /></AdminRoute>} />
            <Route path="flags"      element={<AdminFlags />} />
            <Route path="broadcast"  element={<AdminRoute><AdminBroadcast /></AdminRoute>} />
            <Route path="*"          element={<Navigate to="/admin/dashboard" replace />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}