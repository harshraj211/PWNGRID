/**
 * NotFound.jsx
 * 404 page — shown for all unmatched routes.
 *
 * File location: frontend/src/pages/NotFound.jsx
 */

import { Link } from "react-router-dom";
import "./NotFound.css";

export default function NotFound() {
  return (
    <div className="notfound-page">
      <div className="notfound-bg-grid" aria-hidden="true" />

      <div className="notfound-content">
        <div className="notfound-code">404</div>
        <h1 className="notfound-title">Target not found.</h1>
        <p className="notfound-sub">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="notfound-actions">
          <Link to="/dashboard" className="notfound-btn">
            ← Back to Dashboard
          </Link>
          <Link to="/challenges" className="notfound-btn-ghost">
            Browse Challenges
          </Link>
        </div>
      </div>
    </div>
  );
}