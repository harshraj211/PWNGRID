# Context — OSINT Arena

Date: 2026-02-28

> **Note:** This file is now added to `.gitignore` so that local developer context isn’t committed to the repository.


This `context.md` records the manual work you (the developer) wrote in this repository and provides a concise description of what the project is about and how to run it.

---

## Files you edited / wrote manually

The following files were created/edited manually by you (based on recent edit history). The list has grown substantially since the last snapshot; many components, hooks, services, and backend helpers have been added, so consider this a representative rather than exhaustive inventory:

Frontend (React app)
- `frontend/package.json`
- `frontend/.env`
- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/styles/global.css`
- `frontend/src/styles/theme.css`
- `frontend/src/styles/scanline.css`

Pages & UI
- `frontend/src/pages/Home.jsx`
- `frontend/src/pages/Login.jsx`
- `frontend/src/pages/Register.jsx`
- `frontend/src/pages/VerifyEmail.jsx`
- `frontend/src/pages/ForgotPassword.jsx`
- `frontend/src/pages/Dashboard.jsx`
- `frontend/src/pages/Challenges.jsx`
- `frontend/src/pages/ChallengeSolve.jsx`
- `frontend/src/pages/Profile.jsx`
- `frontend/src/pages/Leaderboard.jsx`
- `frontend/src/pages/Contests.jsx`
- `frontend/src/pages/ContestDetail.jsx`
- `frontend/src/pages/CertVerify.jsx`
- `frontend/src/pages/Pricing.jsx`
- `frontend/src/pages/NotFound.jsx`

Admin pages
- `frontend/src/pages/admin/AdminLayout.jsx`
- `frontend/src/pages/admin/AdminDashboard.jsx`
- `frontend/src/pages/admin/AdminChallenges.jsx`
- `frontend/src/pages/admin/AdminContests.jsx`
- `frontend/src/pages/admin/AdminUsers.jsx`
- `frontend/src/pages/admin/AdminFlags.jsx`

Components & Layout
- `frontend/src/components/ui/Spinner.jsx`
- `frontend/src/components/layout/Navbar.jsx`
- `frontend/src/components/layout/Footer.jsx`
- `frontend/src/components/layout/PageWrapper.jsx`

Context & Routing
- `frontend/src/context/AuthContext.jsx`
- `frontend/src/routes/AppRouter.jsx`
- `frontend/src/routes/PrivateRoute.jsx`
- `frontend/src/routes/AdminRoute.jsx`
- `frontend/src/routes/ProRoute.jsx`

Firebase
- `frontend/src/firebase/config.js`

Cloud Functions (Firebase functions)
- `functions/package.json`
- `functions/.env`
- `functions/.eslintrc.js`
- `functions/src/index.js`
- `functions/src/certifications/checkCertEligibility.js`
- `functions/src/challenges/openChallenge.js`
- `functions/src/challenges/submitAnswer.js`
- `functions/src/leaderboard/resetWeeklyElo.js`
- `functions/src/leaderboard/resetMonthlyElo.js`
- `functions/src/emails/sendContestReminder.js`
- `functions/src/emails/sendBroadcast.js`
- `functions/src/admin/adjustElo.js`
- `functions/src/admin/resolveFlag.js`
- `functions/src/admin/getAnalytics.js`
- `functions/src/lib/calculateElo.js`
- `functions/src/lib/calculateStreak.js`
- `functions/src/lib/normalizeAnswer.js`
- `functions/src/lib/hashAnswer.js`
- `functions/src/lib/antiCheat.js`
- `functions/src/lib/sendgrid.js` (recently updated)
- `functions/src/payments/razorpayWebhook.js` (new)
- `functions/src/lib/heatmap.js` (new)

> **Note:** numerous additional frontend components (tooltips, modals, buttons, profile widgets, leaderboard rows, layouts, etc.), and backend helpers exist now; see the workspace folders for the full current set.

Firebase rules and indexes
- `firestore.rules`
- `firestore.indexes.json`

> Note: This list is compiled from the repository edit history available in the workspace. If you manually edited additional files after the most recent recorded edits, add them here or update this file.

---

## What is this project about?

OSINT Arena is a competitive Open-Source INTelligence (OSINT) learning and challenge platform. It lets users solve OSINT-style puzzles and challenges to earn ELO points, badges, and certifications. The platform supports:

- Single challenges and multi-question contests (time-limited)
- Leaderboards: global, weekly, and monthly rankings
- User profiles with stats, streaks, badges, and certifications
- Admin panel to manage challenges, contests, and users
- Anti-cheat detection for suspicious submission patterns
- Email notifications and broadcast capability (SendGrid wrapper)

Tech stack
- Frontend: React 18 + Vite (client-side app in `frontend/`)
- Backend: Firebase (Auth, Firestore, Storage) and Cloud Functions (`functions/`)
- Email: SendGrid (via a small wrapper in `functions/src/lib/sendgrid.js`)
- CI/CD: GitHub Actions workflows for deploying hosting and functions (`.github/workflows/`)

Project layout (top-level)
- `frontend/` — React app source, pages, components, hooks, services
- `functions/` — Firebase Cloud Functions and server-side logic
- `firestore.rules`, `firestore.indexes.json`, `storage.rules` — Firebase config
- `firebase.json`, `.firebaserc`, `.gitignore`, `README.md`

---

## How to run locally (developer quick start)

Frontend

```bash
cd frontend
npm install
npm run dev
```

Functions (requires Firebase CLI and credentials)

```bash
cd functions
npm install
# set environment variables (SENDGRID_API_KEY, etc.) or use local emulator
# to deploy functions:
# firebase deploy --only functions
```

Environment
- Copy `frontend/.env.example` to `frontend/.env` and add your Firebase credentials and API URL.
- Add `SENDGRID_API_KEY` and `FIREBASE_PROJECT_ID` to `functions/.env` when running functions that send email.

---

## Notes / Next steps

- This file is a snapshot. Update it when you add or heavily modify files so the record stays accurate.
- If you want, I can generate a checklist of remaining TODOs (tests, CI secrets, production env, more robust anti-cheat rules).

### Recent Fixes (March 2026)
- **Local Dev Emulator Environment:** Set up local Firebase Emulator suite for functions (`firebase emulators:start --only functions`) coupled with production Firestore using a service account key over `127.0.0.1:5001`. Created `VITE_USE_FUNCTION_EMULATOR` env switch in the frontend to route requests intelligently and handle missing Blaze plan limitations on deploying functions.
- **Node.js 24 + firebase-admin Compatibility:** Replaced legacy namespace `admin.firestore.Timestamp` and `admin.firestore.FieldValue` access in `openChallenge.js`, `submitAnswer.js`, `completeInvestigation.js`, and `verifyGraphEdge.js` with module imports from `firebase-admin/firestore` to resolve execution crashes (e.g., *Cannot read properties of undefined reading 'fromMillis'*).
- **Submissions Query Indexes:** Restructured `submitAnswer` and `completeInvestigation` queries to drop `.orderBy("timestamp", "desc")` range conditions alongside `userId` and `challengeId` equality checks. Time-range filtering for the 30-min window and finding the earliest First Blood correct answer evaluates in-memory via iterating snapshot results. Avoids failing precondition "The query requires an index."
- **Hash Verification Parity:** Extended backend `hashAnswer.js` pipeline to collapse duplicate whitespaces `replace(/\s+/g, " ")` and introduced the global salt `osint-arena-salt-2024` so it strictly aligns with the frontend `hashAnswer.js`.
- **Admin Visibility and Payload Fields:** Changed Admin backend to correctly use `answerHash` instead of `flagHash` (with a legacy field fallback). Added feature to `AdminChallenges.jsx` to natively store `rawFlag` from Admin entries so that previously entered correct flags are restored securely without re-hashing from scratch upon every Challenge UI edit.

---

If you want me to include diffs or paste the current contents of any file into this document, tell me which ones and I'll append them.