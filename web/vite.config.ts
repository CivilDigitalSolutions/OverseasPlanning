import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Voyager Trip Manager web app, installable as a PWA.
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
        includeAssets: ["icons/favicon.ico", "icons/favicon-16.png", "icons/favicon-32.png", "icons/apple-touch-icon.png", "icons/badge-96.png", "icons/og-image.png"],
        manifest: {
          name: "Voyager Trip Manager",
          short_name: "Voyager",
          description: "Plan, run and debrief overseas trips.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          // Black splash with the white emblem, as on the brand board.
          background_color: "#000000",
          theme_color: "#000000",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        // Custom service worker (src/sw.ts): app-shell caching + push notifications.
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,woff2}"] },
      }),
    ],
  };
});
