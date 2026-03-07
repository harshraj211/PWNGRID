/**
 * AuthContext.jsx — v2
 * Adds: Google Sign-In, auto Firestore profile creation, RBAC
 *
 * File location: frontend/src/context/AuthContext.jsx
 */
import {
  createContext, useContext, useEffect,
  useState, useCallback, useRef,
} from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  reload,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  updateProfile,
} from "firebase/auth";
import {
  doc, onSnapshot, setDoc, getDoc,
  serverTimestamp, collection, query, where, limit, getDocs,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db } from "../firebase/config";

const AuthContext = createContext(null);

let _setCustomClaimsFn = null;
function getSetCustomClaimsFn() {
  if (!_setCustomClaimsFn) {
    _setCustomClaimsFn = httpsCallable(getFunctions(), "setCustomClaims");
  }
  return _setCustomClaimsFn;
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ── Ensure username is unique across all users ───────────────────────────────
async function getUniqueUsername(baseUsername) {
  const base = sanitizeUsername(baseUsername);
  // Check if base is available
  const q = query(collection(db, "users"), where("username", "==", base), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return base;
  // Append numbers until unique
  for (let i = 2; i <= 9999; i++) {
    const candidate = `${base}_${i}`.slice(0, 20);
    const q2 = query(collection(db, "users"), where("username", "==", candidate), limit(1));
    const s2 = await getDocs(q2);
    if (s2.empty) return candidate;
  }
  return `${base}_${Date.now()}`.slice(0, 20);
}

// ── Create Firestore profile if it doesn't exist ──────────────────────────────
async function ensureUserProfile(user, extraData = {}) {
  const ref  = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const provider = user.providerData?.[0]?.providerId || "password";
  const rawUsername = extraData.username || user.displayName || user.email?.split("@")[0] || user.uid.slice(0, 8);
  // Ensure username is unique
  const username = await getUniqueUsername(rawUsername);

  const profile = {
    uid:          user.uid,
    email:        user.email || "",
    username,
    displayName:  user.displayName || username,
    photoURL:     user.photoURL    || null,
    provider,
    role:         "user",
    plan:         "free",
    elo:          0,
    weeklyElo:    0,
    monthlyElo:   0,
    totalSolved:  0,
    correctSubmissions: 0,
    wrongSubmissions:   0,
    solvedByDifficulty: { easy: 0, medium: 0, hard: 0 },
    currentStreak:  0,
    maxStreak:      0,
    lastActiveDate: null,
    dailySolves:    {},
    streakFreezes:  0,
    certifications: {},
    totalCertificates: 0,
    badges:         [],
    isBanned:       false,
    isFlagged:      false,
    warningCount:   0,
    flagCount:      0,
    proSince:       null,
    proExpiresAt:   null,
    createdAt:      serverTimestamp(),
    lastLoginAt:    serverTimestamp(),
  };

  const publicProfile = {
    uid:          user.uid,
    username,
    plan:         "free",
    elo:          0,
    weeklyElo:    0,
    monthlyElo:   0,
    totalSolved:  0,
    currentStreak: 0,
    maxStreak:    0,
    badges:       [],
    latestCert:   null,
    createdAt:    serverTimestamp(),
  };

  await Promise.all([
    setDoc(ref, profile),
    setDoc(doc(db, "publicProfiles", user.uid), publicProfile),
  ]);

  return profile;
}

function sanitizeUsername(raw) {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 20);
  return cleaned.length < 3 ? `user_${cleaned.padEnd(3, "0")}`.slice(0, 20) : cleaned;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser]       = useState(null);
  const [userProfile, setUserProfile]       = useState(null);
  const [claims, setClaims]                 = useState(null);
  const [loading, setLoading]               = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [claimsReady, setClaimsReady]       = useState(false);
  const profileUnsubRef = useRef(null);

  // Handle Google redirect result on page load
  useEffect(() => {
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          await ensureUserProfile(result.user);
        }
      })
      .catch((err) => {
        // ignore popup-closed or cancelled redirects
        if (err.code !== "auth/cancelled-popup-request" &&
            err.code !== "auth/popup-closed-by-user") {
          console.error("getRedirectResult error:", err);
        }
      });
  }, []);

  useEffect(() => {
    const unsubAuth = onIdTokenChanged(auth, async (user) => {
      setCurrentUser(user);

      if (!user) {
        setUserProfile(null);
        setClaims(null);
        setClaimsReady(false);
        setProfileLoading(false);
        setLoading(false);
        if (profileUnsubRef.current) { profileUnsubRef.current(); profileUnsubRef.current = null; }
        return;
      }

      // Read JWT claims
      try {
        const result = await user.getIdTokenResult();
        const c = result.claims || {};
        const proExpired = c.proExpiresAt ? new Date(c.proExpiresAt) < new Date() : false;
        setClaims({
          plan:         proExpired ? "free" : (c.plan || "free"),
          role:         c.role || "user",
          proExpiresAt: c.proExpiresAt || null,
          proExpired,
        });
      } catch {
        setClaims({ plan: "free", role: "user", proExpiresAt: null, proExpired: false });
      }
      setClaimsReady(true);

      // Subscribe to Firestore profile
      if (!profileUnsubRef.current) {
        setProfileLoading(true);
        const userRef = doc(db, "users", user.uid);
        profileUnsubRef.current = onSnapshot(userRef,
          (snap) => {
            setUserProfile(snap.exists() ? { id: snap.id, ...snap.data() } : null);
            setProfileLoading(false);
            setLoading(false);
          },
          () => { setProfileLoading(false); setLoading(false); }
        );
      } else {
        setLoading(false);
      }
    });

    return () => {
      unsubAuth();
      if (profileUnsubRef.current) { profileUnsubRef.current(); profileUnsubRef.current = null; }
    };
  }, []);

  // ── Auth actions ────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    return await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    // signInWithRedirect avoids COOP/popup issues in all environments
    await signInWithRedirect(auth, googleProvider);
    // Navigation will happen after redirect returns — no return value needed
  }, []);

  const register = useCallback(async (email, password, username) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    // Set displayName immediately
    await updateProfile(result.user, { displayName: username });
    // Create Firestore profile
    await ensureUserProfile(result.user, { username });
    // Send verification email
    await sendEmailVerification(result.user);
    return result;
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const resetPassword = useCallback(async (email) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  const resendVerification = useCallback(async () => {
    if (currentUser && !currentUser.emailVerified) {
      await sendEmailVerification(currentUser);
    }
  }, [currentUser]);

  const refreshUser = useCallback(async () => {
    if (!currentUser) return;
    await reload(currentUser);
    await currentUser.getIdToken(true);
  }, [currentUser]);

  const syncClaims = useCallback(async () => {
    if (!currentUser) return null;
    try {
      const fn = getSetCustomClaimsFn();
      const result = await fn();
      await currentUser.getIdToken(true);
      return result.data;
    } catch (err) {
      console.error("syncClaims failed", err);
      throw err;
    }
  }, [currentUser]);

  // ── Derived state ────────────────────────────────────────────────────────────
  const isVerified      = Boolean(currentUser?.emailVerified);
  const isAuthenticated = Boolean(currentUser);
  const isAdmin         = userProfile?.role === "admin";
  const isMod           = userProfile?.role === "mod" || userProfile?.role === "moderator" || isAdmin;
  const isContestMod    = userProfile?.role === "contest_mod" || isMod;
  const isPro           = isAdmin || claims?.plan === "pro";

  const canSolveToday = useCallback(() => {
    if (isPro) return true;
    const today = new Date().toISOString().split("T")[0];
    return (userProfile?.dailySolves?.[today] ?? 0) < 5;
  }, [isPro, userProfile]);

  const dailySolvesRemaining = useCallback(() => {
    if (isPro) return Infinity;
    const today = new Date().toISOString().split("T")[0];
    return Math.max(0, 5 - (userProfile?.dailySolves?.[today] ?? 0));
  }, [isPro, userProfile]);

  // ── RBAC helpers ─────────────────────────────────────────────────────────────
  const canCreateChallenge  = isMod;
  const canEditChallenge    = isMod;
  const canDeleteChallenge  = isAdmin; // permanent delete
  const canManageUsers      = isAdmin;
  const canManageContests   = isContestMod; // contest_mod, mod, or admin

  const value = {
    currentUser, userProfile, loading, profileLoading, claimsReady, claims,
    isAuthenticated, isVerified, isAdmin, isMod, isContestMod, isPro,
    canCreateChallenge, canEditChallenge, canDeleteChallenge, canManageUsers,
    canManageContests,
    canSolveToday, dailySolvesRemaining,
    login, loginWithGoogle, register, logout,
    resetPassword, resendVerification, refreshUser, syncClaims,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}