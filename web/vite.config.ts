import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

/**
 * Voyager Trip Manager web app, installable as a PWA.
 *
 * The build FAILS when the Firebase web config is missing: a bundle built without it throws before
 * React mounts and shows a blank page (a lesson from TrackLink, 2026-07-14). Set VITE_FB_* in
 * web/.env.local (see .env.example).
 */
const REQUIRED = ["VITE_FB_API_KEY", "VITE_FB_AUTH_DOMAIN", "VITE_FB_PROJECT_ID", "VITE_FB_APP_ID"];

/**
 * VITE_BACKEND=laravel builds the app against the Laravel API on AWS (docs/MIGRATION-PLAN.md §5):
 * the Firebase-facing modules are swapped for src/api/* (same technique as the demo build). Every
 * screen component is unchanged. The output contains no Firebase code or configuration.
 */
const src = resolve(__dirname, "src").replace(/\\/g, "/");
const LARAVEL_SWAPS: Record<string, string> = {
  "./store": "api/store.ts",
  "./Auth": "api/Auth.tsx",
  "./passkeys": "api/passkeys.ts",
  "./firebase": "api/firebaseShim.ts",
  "firebase/auth": "api/firebaseShim.ts",
};
function laravelSwaps(): Plugin {
  return {
    name: "laravel-swaps",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !LARAVEL_SWAPS[source]) return null;
      const from = importer.replace(/\\/g, "/");
      if (!from.startsWith(src) || from.includes("/src/api/") || from.includes("/src/demo/")) return null;
      return resolve(src, LARAVEL_SWAPS[source]);
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const laravel = (process.env.VITE_BACKEND ?? env.VITE_BACKEND) === "laravel";
  if (command === "build" && !laravel && process.env.ALLOW_MISSING_FB_CONFIG !== "1") {
    const missing = REQUIRED.filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(`Missing ${missing.join(", ")} in web/.env.local — the app cannot start without them.`);
    }
  }
  return {
    define: { "import.meta.env.VITE_BACKEND": JSON.stringify(laravel ? "laravel" : "firebase") },
    // Local development against `php artisan serve` (same origin through the proxy, as in AWS).
    server: laravel ? { proxy: { "/api": "http://127.0.0.1:8000", "/sanctum": "http://127.0.0.1:8000" } } : undefined,
    plugins: [
      ...(laravel ? [laravelSwaps()] : []),
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
