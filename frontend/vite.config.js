/**
 * vite.config.js
 * Vite configuration for PwnGrid frontend.
 *
 * Key features:
 *  - React plugin with fast refresh
 *  - Path alias: @ → src/
 *  - Dev server proxy for Firebase emulators (avoids CORS in local dev)
 *  - Production build: code splitting, chunk size warnings, source maps off
 *  - Preview server on port 4173 (mirrors Firebase Hosting)
 *
 * File location: frontend/vite.config.js
 */

import { defineConfig, loadEnv } from "vite";
import react                     from "@vitejs/plugin-react";
import { resolve }               from "path";

export default defineConfig(({ mode }) => {
  // Load env so we can read VITE_* vars inside config if needed
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    // ── Plugins ────────────────────────────────────────────────────────────
    plugins: [
      react({
        // Babel fast refresh — no config needed for standard React
        fastRefresh: true,
      }),
    ],

    // ── Path aliases ───────────────────────────────────────────────────────
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
        "@components": resolve(__dirname, "src/components"),
        "@pages":      resolve(__dirname, "src/pages"),
        "@context":    resolve(__dirname, "src/context"),
        "@styles":     resolve(__dirname, "src/styles"),
        "@routes":     resolve(__dirname, "src/routes"),
        // NOTE: no @firebase alias — conflicts with the firebase npm package
      },
    },

    // ── Dev server ─────────────────────────────────────────────────────────
    server: {
      port:        3000,
      strictPort:  false, // try next available port if 3000 is taken
      open:        false, // don't auto-open browser
      host:        true,  // expose to local network (useful for mobile testing)

      // Allow Firebase Google Sign-In popup to communicate back to the parent
      // window. Vite's default COOP: same-origin blocks the popup channel.
      headers: {
        "Cross-Origin-Opener-Policy":   "same-origin-allow-popups",
        "Cross-Origin-Embedder-Policy": "unsafe-none",
      },

      // Proxy Firebase emulator endpoints to avoid CORS issues in dev.
      // Only active when running `vite` (not `vite build`).
      proxy: env.VITE_USE_EMULATOR === "true"
        ? {
            // Firestore emulator REST API
            "/google.firestore.v1.Firestore": {
              target:      "http://localhost:8080",
              changeOrigin: true,
            },
            // Functions emulator
            "/us-central1": {
              target:      "http://localhost:5001",
              changeOrigin: true,
            },
          }
        : {},
    },

    // ── Preview server (vite preview) ──────────────────────────────────────
    preview: {
      port: 4173,
      // Mirrors Firebase Hosting SPA rewrite — all routes → index.html
      // Note: actual SPA rewrite is in firebase.json; this is for local preview
    },

    // ── Build ──────────────────────────────────────────────────────────────
    build: {
      outDir:         "dist",
      emptyOutDir:    true,

      // No source maps in production builds (reduces bundle size + hides code)
      sourcemap:      false,

      // Raise chunk warning threshold (Firebase SDK is large by design)
      chunkSizeWarningLimit: 1000, // kB

      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching:
          //  - firebase-core: shared firebase/app, auth, firestore
          //  - firebase-functions: only loaded on callable pages
          //  - vendor: react, react-dom, react-router
          manualChunks: {
            "vendor":             ["react", "react-dom", "react-router-dom"],
            "firebase-core":      ["firebase/app", "firebase/auth", "firebase/firestore"],
            "firebase-functions": ["firebase/functions"],
            "firebase-analytics": ["firebase/analytics"],
            "markdown":           ["react-markdown"],
          },
        },
      },
    },

    // ── Environment variable exposure ──────────────────────────────────────
    // Only VITE_* prefixed vars are exposed to the browser.
    // This is Vite's default behaviour — listed here for documentation.
    envPrefix: "VITE_",

    // ── CSS ────────────────────────────────────────────────────────────────
    css: {
      // No pre-processor needed — plain CSS with variables
      // PostCSS config in postcss.config.js if needed in future
      devSourcemap: true,
    },

    // ── Test ───────────────────────────────────────────────────────────────
    // Vitest config (if you migrate from Jest)
    test: {
      environment: "jsdom",
      globals:     true,
      setupFiles:  "./src/test/setup.js",
    },
  };
});