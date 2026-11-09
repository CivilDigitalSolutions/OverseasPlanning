import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Overseas Planning web app, installable as a PWA.
 *
 * The build FAILS when the Firebase web config is missing: a bundle built without it throws before
 * React mounts and shows a blank page (a lesson from TrackLink, 2026-07-14). Set VITE_FB_* in
 * web/.env.local (see .env.example).
 */
const REQUIRED = ["VITE_FB_API_KEY", "VITE_FB_AUTH_DOMAIN", "VITE_FB_PROJECT_ID", "VITE_FB_APP_ID"];

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (command === "build" && process.env.ALLOW_MISSING_FB_CONFIG !== "1") {
    const missing = REQUIRED.filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`Missing ${missing.join(", ")} in web/.env.local — the app cannot start without them.`);
    }
  }
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icons/icon.svg", "icons/apple-touch-icon.png"],
        manifest: {
          name: "Overseas Planning",
          short_name: "Overseas",
          description: "Plan, run and debrief overseas trips.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          background_color: "#F4F6FA",
          theme_color: "#13294B",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          // App shell only. Trip data is NOT cached by the service worker: Firestore keeps its own
          // offline cache, and caching API responses here could leave sensitive data on a device.
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/__/],
        },
      }),
    ],
  };
});
