import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

/**
 * Builds the claude.ai artifact DEMO: one self-contained HTML file (web/dist-demo/index.html).
 * The real app's Firebase-facing modules are swapped for src/demo/* versions; every screen
 * component is the production one. Run: npm run build:demo
 */
const src = resolve(__dirname, "src");
const SWAPS: Record<string, string> = {
  "./store": "demo/store.ts",
  "./Auth": "demo/Auth.tsx",
  "./passkeys": "demo/passkeys.ts",
  "./firebase": "demo/firebaseShim.ts",
  "firebase/auth": "demo/firebaseShim.ts",
  "./download": "demo/download.ts",
  "./InstallPrompt": "demo/InstallPrompt.tsx",
};
function demoSwaps(): Plugin {
  return {
    name: "demo-swaps",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !SWAPS[source]) return null;
      const from = importer.replace(/\\/g, "/");
      // Only swap imports made by the real app's own modules (not the demo files themselves).
      if (!from.startsWith(src.replace(/\\/g, "/")) || from.includes("/src/demo/")) return null;
      return resolve(src, SWAPS[source]);
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, "demo"),
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("1") },
  plugins: [demoSwaps(), react(), viteSingleFile()],
  build: { outDir: resolve(__dirname, "dist-demo"), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
