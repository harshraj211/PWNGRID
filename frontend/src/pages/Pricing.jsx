/**
 * Pricing.jsx
 * Pricing page with Free vs Pro comparison.
 * Handles Razorpay checkout for Indian payments.
 *
 * Razorpay flow:
 *  1. User clicks "Upgrade" → calls Razorpay checkout script
 *  2. On payment success → call a Cloud Function to verify + update Firestore
 *  3. AuthContext re-syncs via Firestore listener → isPro becomes true
 *
 * File location: frontend/src/pages/Pricing.jsx
 */

import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PageWrapper from "../components/layout/PageWrapper";
import "./Pricing.css";

// Razorpay key — set in frontend/.env
const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY_ID;

const PLANS = {
  monthly: { label: "Monthly", price: 499,  priceDisplay: "₹499",  period: "/month",   saving: null },
  yearly:  { label: "Yearly",  price: 3999, priceDisplay: "₹3,999", period: "/year",    saving: "Save ₹1,989" },
};

const FREE_FEATURES = [
  "All easy challenges",
  "All medium challenges",
  "1 free hard challenge per week",
  "All weekly & monthly contests",
  "Global ELO ranking + heatmap",
  "Public profile page",
];

const PRO_FEATURES = [
  "All hard challenges (unlimited)",
  "OSINT certifications",
  "Advanced analytics",
  "2 streak freezes per month",
  "Priority support",
  "Everything in Free",
];

export default function Pricing() {
  const { currentUser, isPro, syncClaims } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const reason = location.state?.reason; // "pro_required" from ProRoute redirect
  const from   = location.state?.from?.pathname;

  const [billing, setBilling]     = useState("monthly");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState(false);

  // Load Razorpay script once
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
    return () => document.body.removeChild(script);
  }, []);

  async function handleUpgrade() {
    if (!currentUser) {
      navigate("/register", { state: { from: location } });
      return;
    }
    if (isPro) return;

    setLoading(true);
    setError("");

    try {
      const plan = PLANS[billing];

      // In production: call a Cloud Function to create a Razorpay order
      // For now we open the checkout directly with amount
      // TODO: Replace with: const order = await createRazorpayOrder({ amount: plan.price * 100, billing })

      const options = {
        key: RAZORPAY_KEY,
        amount: plan.price * 100, // paise
        currency: "INR",
        name: "PwnGrid",
        description: `Pro Plan — ${plan.label}`,
        // order_id: order.id,  // Uncomment when backend order creation is ready
        prefill: {
          email: currentUser.email,
        },
        theme: {
          color: "#00FF88",
          backdrop_color: "#0D0F12",
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
        handler: async (_response) => {
          // Payment captured — webhook handles Firestore write.
          // We call syncClaims to force a JWT refresh so isPro updates
          // in the current session without waiting for the next token rotation.
          try {
            await syncClaims();         // calls setCustomClaims CF + force token refresh
            setSuccess(true);
            setLoading(false);
            setTimeout(() => {
              navigate(from || "/dashboard");
            }, 2500);
          } catch (err) {
            // syncClaims failure is non-fatal — the webhook will have upgraded
            // the account; user just needs to sign out and back in.
            setSuccess(true);           // payment still succeeded
            setLoading(false);
            setTimeout(() => navigate(from || "/dashboard"), 2500);
          }
        },
      };

      if (!window.Razorpay) {
        throw new Error("Payment service not loaded. Please refresh and try again.");
      }

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (response) => {
        setError(`Payment failed: ${response.error.description}`);
        setLoading(false);
      });
      rzp.open();

    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // Already Pro — show manage screen
  if (isPro) {
    return (
      <PageWrapper>
        <div className="pricing-page">
          <div className="pricing-already-pro">
            <div className="pricing-pro-icon">✦</div>
            <h1 className="pricing-already-title">You&apos;re on Pro</h1>
            <p className="pricing-already-sub">
              You have full access to all PwnGrid features.
            </p>
            <Link to="/dashboard" className="pricing-back-btn">
              Back to Dashboard →
            </Link>
          </div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="pricing-page">
        <div className="pricing-bg-grid" aria-hidden="true" />

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="pricing-header">
          {reason === "pro_required" && (
            <div className="pricing-reason-banner">
              ⚡ This feature requires a Pro plan
            </div>
          )}
          <h1 className="pricing-title">
            Upgrade your<br />
            <span className="pricing-title-accent">intelligence</span>
          </h1>
          <p className="pricing-subtitle">
            Unlimited hard challenges, certifications, and advanced analytics.
          </p>
        </div>

        {/* ── Billing toggle ───────────────────────────────────────────── */}
        <div className="pricing-toggle-wrap">
          <div className="pricing-toggle">
            <button
              className={`pricing-toggle-btn ${billing === "monthly" ? "pricing-toggle-btn--active" : ""}`}
              onClick={() => setBilling("monthly")}
            >
              Monthly
            </button>
            <button
              className={`pricing-toggle-btn ${billing === "yearly" ? "pricing-toggle-btn--active" : ""}`}
              onClick={() => setBilling("yearly")}
            >
              Yearly
              <span className="pricing-toggle-saving">Save 33%</span>
            </button>
          </div>
        </div>

        {/* ── Plan cards ───────────────────────────────────────────────── */}
        <div className="pricing-cards">

          {/* Free card */}
          <div className="pricing-card pricing-card--free">
            <div className="pricing-card-header">
              <span className="pricing-plan-name">Free</span>
              <div className="pricing-price-row">
                <span className="pricing-price">₹0</span>
                <span className="pricing-period">forever</span>
              </div>
            </div>

            <ul className="pricing-features">
              {FREE_FEATURES.map((f, i) => (
                <li key={i} className="pricing-feature">
                  <span className="pricing-feature-icon pricing-feature-icon--neutral">○</span>
                  {f}
                </li>
              ))}
            </ul>

            {currentUser ? (
              <div className="pricing-current-plan">Current plan</div>
            ) : (
              <Link to="/register" className="pricing-free-btn">
                Get started free
              </Link>
            )}
          </div>

          {/* Pro card */}
          <div className="pricing-card pricing-card--pro">
            <div className="pricing-card-badge">Most Popular</div>

            <div className="pricing-card-header">
              <span className="pricing-plan-name pricing-plan-name--pro">Pro</span>
              <div className="pricing-price-row">
                <span className="pricing-price pricing-price--pro">
                  {PLANS[billing].priceDisplay}
                </span>
                <span className="pricing-period">{PLANS[billing].period}</span>
              </div>
              {PLANS[billing].saving && (
                <span className="pricing-saving">{PLANS[billing].saving}</span>
              )}
              <span className="pricing-cancel-note">Cancel anytime · No questions asked</span>
            </div>

            <ul className="pricing-features">
              {PRO_FEATURES.map((f, i) => (
                <li key={i} className="pricing-feature">
                  <span className="pricing-feature-icon pricing-feature-icon--pro">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {error && (
              <div className="pricing-error">
                <span>⚠</span> {error}
              </div>
            )}

            {success ? (
              <div className="pricing-success">
                <span>✓</span> Payment successful! Activating Pro...
              </div>
            ) : (
              <button
                className="pricing-upgrade-btn"
                onClick={handleUpgrade}
                disabled={loading}
              >
                {loading ? (
                  <span className="pricing-btn-loading">
                    <span className="pricing-btn-spinner" />
                    Opening checkout...
                  </span>
                ) : currentUser ? (
                  `Upgrade to Pro — ${PLANS[billing].priceDisplay}`
                ) : (
                  "Create account to upgrade"
                )}
              </button>
            )}

            <p className="pricing-card-note">
              Secure payment via Razorpay · Cancel anytime
            </p>
          </div>

        </div>

        {/* ── FAQ ─────────────────────────────────────────────────────── */}
        <div className="pricing-faq">
          <h2 className="pricing-faq-title">Common questions</h2>
          <div className="pricing-faq-grid">
            {FAQ.map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

      </div>
    </PageWrapper>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`pricing-faq-item ${open ? "pricing-faq-item--open" : ""}`}>
      <button className="pricing-faq-q" onClick={() => setOpen(v => !v)}>
        {q}
        <span className="pricing-faq-chevron">{open ? "−" : "+"}</span>
      </button>
      {open && <p className="pricing-faq-a">{a}</p>}
    </div>
  );
}

// ── FAQ data ──────────────────────────────────────────────────────────────────

const FAQ = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel your Pro subscription at any time. You'll retain Pro access until the end of your current billing period.",
  },
  {
    q: "What payment methods are accepted?",
    a: "We accept all major credit/debit cards, UPI, net banking, and wallets via Razorpay.",
  },
  {
    q: "What are streak freezes?",
    a: "Streak freezes let you preserve your solving streak if you miss a day. Pro users get 2 per month, automatically refreshed on the 1st.",
  },
  {
    q: "What certifications are available?",
    a: "Pro users who complete all challenges in a difficulty tier become eligible for a verifiable OSINT certification. Certificates have a public URL you can share on LinkedIn.",
  },
  {
    q: "Is there a student discount?",
    a: "We don't currently have a student discount, but the free tier is fully functional for learning. Reach out to us if you're a student with limited access.",
  },
  {
    q: "Will I lose my data if I downgrade?",
    a: "No. All your ELO, solves, and history are preserved forever. You'll just lose access to Pro features like contests.",
  },
];