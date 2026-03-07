<div align="center">

<h1>⚡ PWNGRID</h1>

[![Status](https://img.shields.io/badge/Status-Active-00ff88?style=for-the-badge)](https://github.com/harshraj211/pwngrid)
[![Frontend](https://img.shields.io/badge/React_+_Vite-Frontend-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://vitejs.dev)
[![Backend](https://img.shields.io/badge/Firebase_Functions-Backend-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)](https://firebase.google.com)
[![License](https://img.shields.io/badge/License-Proprietary-FF4444?style=for-the-badge)](./LICENSE)

</div>

---

## Overview

**PWNGRID** is a highly scalable, full-stack cybersecurity training and Capture The Flag (CTF) platform built for both enthusiasts and seasoned professionals. It delivers a competitive, real-time environment for solving security challenges, participating in timed contests, and tracking progression through a dynamic Elo-based ranking system.

Architected entirely on Firebase's serverless infrastructure, the platform provides seamless real-time interactions, automated anti-cheat enforcement, and secure challenge execution at scale.

---

## Key Features

| Feature | Description |
|---|---|
| 🚩 **Interactive CTF Environment** | Jeopardy-style challenges, writeups, and complex investigation boards |
| ⚡ **Live Contests** | Timed competitive events with real-time race charts and auto-generated leaderboards |
| 📊 **Elo Progression System** | Advanced Elo rating engine with streak counters, rank badges, and automated weekly/monthly resets |
| 🛡️ **Automated Anti-Cheat** | Backend heuristics to detect suspicious activity, rapid submissions, and answer sharing |
| 🔧 **Admin Workspace** | Secure portal for managing challenges, flagged accounts, email broadcasts, and manual Elo adjustments |
| 💳 **Payments & Certifications** | Razorpay-powered Pro subscriptions with automated certification verification |
| ☁️ **Serverless Architecture** | Entirely Firebase Cloud Functions with strict Firestore security rules |

---

## Tech Stack

### Frontend
- **Framework:** React.js + Vite
- **Routing:** React Router with Auth, Pro, and Mod/Admin guards
- **Styling:** CSS3, CSS Modules with custom theming (`theme.css`)
- **Media:** Cloudinary integration for optimized asset delivery

### Backend & Infrastructure
- **Compute:** Firebase Cloud Functions (Node.js 18+)
- **Database:** Cloud Firestore (NoSQL)
- **Auth:** Firebase Authentication — Email/Password with Custom Claims for role management
- **Storage:** Firebase Cloud Storage with secure proxy downloads and file validation
- **CI/CD:** GitHub Actions — automated deployment pipelines for Hosting and Functions

### Integrations
- **Payments:** Razorpay Webhooks
- **Email:** SendGrid API

---

## Project Structure
```
pwngrid/
├── .github/workflows/          # CI/CD — Firebase Hosting & Functions pipelines
├── frontend/                   # React + Vite client application
│   ├── public/                 # Static assets
│   └── src/
│       ├── components/         # Reusable UI (Admin, Challenges, Heatmaps)
│       ├── context/            # React Context (Auth, Theme)
│       ├── hooks/              # Custom hooks (useAuth, useLeaderboard)
│       ├── pages/              # Application views (Dashboard, ContestSolve, Profile)
│       ├── services/           # API abstraction layer → Firebase Functions
│       ├── styles/             # Global stylesheets and scanline themes
│       └── utils/              # Helpers (hashing, date formatting, Elo colors)
├── functions/                  # Firebase Cloud Functions (serverless backend)
│   └── src/
│       ├── admin/              # Admin-restricted functions
│       ├── auth/               # User creation hooks and custom claims
│       ├── challenges/         # Challenge verification and unlocks
│       ├── contests/           # Registration and real-time contest logic
│       ├── emails/             # SendGrid broadcast automation
│       ├── leaderboard/        # Cron jobs for Elo metric resets
│       ├── lib/                # Shared utilities (antiCheat, Hash, Elo)
│       ├── payments/           # Razorpay webhook handlers
│       └── storage/            # Secure proxy downloads
├── firebase.json               # Firebase CLI deployment configuration
├── firestore.rules             # Firestore database security rules
├── storage.rules               # Cloud Storage security rules
└── seed.js                     # Database seeding script

Getting Started
Prerequisites

Node.js v18.0.0+
Firebase CLI — npm install -g firebase-tools
Package Manager — npm or yarn

1. Clone the Repository
   git clone https://github.com/harshraj211/pwngrid.git
   cd pwngrid
2. Configure Firebase
   firebase login
   firebase use <your-project-id>
3. Frontend Setup
   cd frontend
   npm install

   # Configure environment variables
   cp .env.example .env
   # → Fill in your Firebase and API keys in .env

   npm run dev
4. Backend Setup
   cd ../functions
   npm install

   # Run functions locally with Firebase emulators
   npm run serve
Environment Variables
Frontend — frontend/.env

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

Backend — Firebase Secrets
Secrets are stored securely via the Firebase CLI and never committed to source control.
firebase functions:secrets:set SENDGRID_API_KEY
firebase functions:secrets:set RAZORPAY_KEY_SECRET
VITE_CLOUDINARY_URL=

Deployment
PWNGRID uses GitHub Actions for fully automated CI/CD.
TriggerWorkflowTargetPush to maindeploy-hosting.ymlFirebase Hosting (Frontend)Push to maindeploy-functions.ymlFirebase Cloud Functions

Manual deployment via Firebase CLI:
# Deploy Firestore rules, indexes, and Storage rules
firebase deploy --only firestore,storage

# Deploy Cloud Functions
firebase deploy --only functions

# Build and deploy the React frontend
cd frontend && npm run build
firebase deploy --only hosting


License
This repository and all its contents are proprietary and confidential. Unauthorized copying, distribution, or use of this software, in whole or in part, is strictly prohibited without explicit written permission from the author.
© 2026 PWNGRID. All rights reserved.

<div align="center">
  <sub>Built with precision. Designed for the elite.</sub>
</div>
````
