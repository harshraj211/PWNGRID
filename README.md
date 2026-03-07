🌐 PWNGRID
<div align="center">
<img alt="Project Status" src="https://img.shields.io/badge/Status-Active-success.svg">
<img alt="Frontend" src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-blue.svg">
<img alt="Backend" src="https://img.shields.io/badge/Backend-Firebase%20Functions-orange.svg">
<img alt="License" src="https://img.shields.io/badge/License-Proprietary-red.svg">
</div>

<br />

📖 Overview
PWNGRID is a highly scalable, full-stack cybersecurity training and Capture The Flag (CTF) platform. Designed for both enthusiasts and professionals, it provides a competitive environment for solving security challenges, participating in timed contests, and tracking progression through a dynamic Elo-based ranking system.

Built heavily on serverless architecture using Firebase, the platform offers seamless real-time interactions, automated anti-cheat mechanisms, and secure code/answer execution.

✨ Key Features
Interactive CTF Environment: Support for traditional jeopardy-style challenges, writeups, and complex investigation boards.

Live Contests: Timed, real-time competitive events with dynamic race charts and automated leaderboard generation.

Competitive Elo & Progression System: Features an advanced Elo rating engine, streak counters, global rank badges, and automated weekly/monthly Elo resets.

Automated Anti-Cheat: Built-in backend heuristics (antiCheat.js) to flag suspicious activity, rapid submissions, or answer sharing.

Robust Admin Workspace: A secure admin portal for managing challenges, monitoring flagged accounts, broadcasting emails, and adjusting player Elo manually.

Seamless Payments & Certifications: Razorpay integration for Pro subscriptions alongside automated certification verification.

Serverless Backend: Entirely powered by Firebase Cloud Functions with strict Firestore security rules (firestore.rules).

🛠 Tech Stack & Architecture
Frontend
Core: React.js, Vite

Routing: React Router (with Auth, Pro, and Mod/Admin guards)

Styling: CSS3, CSS Modules (Custom theming with theme.css)

Assets: Cloudinary Integration for optimized media delivery

Backend & Infrastructure
Compute: Firebase Cloud Functions (Node.js 18+)

Database: Cloud Firestore (NoSQL)

Authentication: Firebase Auth (Email/Password, Custom Claims for Roles)

Storage: Firebase Cloud Storage (Proxy downloads and secure file validation)

CI/CD: GitHub Actions (Automated deployments for Hosting and Functions)

Integrations
Payments: Razorpay Webhooks

Emails: SendGrid API

📂 Project Structure
The repository is structured as a monorepo separating the client application and serverless infrastructure.

Plaintext
pwngrid/
├── .github/workflows/      # CI/CD pipelines for Firebase Hosting & Functions
├── frontend/               # React Vite Application
│   ├── public/             # Static assets
│   ├── src/
│   │   ├── components/     # Reusable UI components (Admin, Challenges, Heatmaps)
│   │   ├── context/        # React Context (Auth, Theme)
│   │   ├── hooks/          # Custom React hooks (useAuth, useLeaderboard)
│   │   ├── pages/          # Application views (Dashboard, ContestSolve, Profile)
│   │   ├── services/       # API abstraction layer calling Firebase Functions
│   │   ├── styles/         # Global stylesheets and scanline themes
│   │   └── utils/          # Helpers (hashing, date formatting, elo colors)
│   └── vite.config.js      # Vite build configuration
├── functions/              # Firebase Cloud Functions (Backend)
│   ├── src/
│   │   ├── admin/          # Admin-only restricted functions
│   │   ├── auth/           # User creation hooks and custom claims setting
│   │   ├── challenges/     # Challenge verification and unlocks
│   │   ├── contests/       # Registration and real-time contest logic
│   │   ├── emails/         # SendGrid automated broadcasting
│   │   ├── leaderboard/    # Cron jobs for resetting Elo metrics
│   │   ├── lib/            # Shared backend utilities (antiCheat, Hash, Elo)
│   │   ├── payments/       # Razorpay webhook handlers
│   │   └── storage/        # Secure proxy downloads
│   └── package.json        # Cloud functions dependencies
├── firebase.json           # Firebase CLI deployment configuration
├── firestore.rules         # Security rules for database access
├── storage.rules           # Security rules for cloud storage
└── seed.js                 # Database seeding script
🚀 Getting Started
Prerequisites
Node.js: v18.0.0 or higher

Firebase CLI: Installed globally (npm install -g firebase-tools)

Package Manager: npm or yarn

1. Clone the repository
Bash
git clone https://github.com/harshraj211/pwngrid.git
cd pwngrid
2. Setup Firebase Environment
Ensure you are logged into Firebase and have access to the target project.

Bash
firebase login
firebase use <your-project-id>
3. Frontend Setup
Bash
cd frontend
npm install

# Copy environment variables and fill in your Firebase/API keys
cp .env.example .env

# Start the development server
npm run dev
4. Backend (Functions) Setup
Bash
cd ../functions
npm install

# (Optional) Run functions locally using Firebase emulators
npm run serve
🔐 Environment Variables
You will need to configure the following environment variables.

Frontend (frontend/.env):

VITE_FIREBASE_API_KEY

VITE_FIREBASE_AUTH_DOMAIN

VITE_FIREBASE_PROJECT_ID

VITE_FIREBASE_STORAGE_BUCKET

VITE_FIREBASE_MESSAGING_SENDER_ID

VITE_FIREBASE_APP_ID

VITE_CLOUDINARY_URL

Backend (Firebase Secrets):

SENDGRID_API_KEY

RAZORPAY_KEY_SECRET

(Use firebase functions:secrets:set <SECRET_NAME> to store backend variables securely).

🚢 Deployment
The project leverages GitHub Actions for CI/CD.

Pushing to the main branch automatically triggers .github/workflows/deploy-hosting.yml for the frontend.

Changes to the backend trigger .github/workflows/deploy-functions.yml.

To deploy manually via the Firebase CLI:

Bash
# Deploy database rules, indexes, and storage rules
firebase deploy --only firestore,storage

# Deploy Cloud Functions
firebase deploy --only functions

# Deploy React Frontend
cd frontend
npm run build
firebase deploy --only hosting
🤝 Contributing
Create a Feature Branch (git checkout -b feature/AmazingFeature)

Commit your Changes (git commit -m 'Add some AmazingFeature')

Push to the Branch (git push origin feature/AmazingFeature)

Open a Pull Request

Please ensure your code passes ESLint checks (npm run lint) before submitting a PR.

📄 License
This repository is proprietary. Unauthorized copying of this file, via any medium is strictly prohibited. Proprietary and confidential.
