// Builds the GitHub Pages client demo (web/dist-pages) from the demo build (web/dist-demo).
// The demo keeps every trip in the visitor's own browser: no Firebase, no server, no real data.
// Usage: npm run build:pages
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "dist-pages");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let html = readFileSync(join(web, "dist-demo", "index.html"), "utf8");
const head = [
  '<meta name="robots" content="noindex, nofollow" />',
  '<meta name="description" content="Voyager Trip Manager — demonstration. Data stays in this browser." />',
  '<meta name="theme-color" content="#000000" />',
  '<link rel="icon" href="icons/favicon.ico" sizes="any" />',
  '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png" />',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />',
].join("\n    ");
html = html.replace(/<title>[^<]*<\/title>/, `<title>Voyager Trip Manager — Demo</title>\n    ${head}`);
if (!html.includes("noindex")) throw new Error("could not inject the page head");
writeFileSync(join(out, "index.html"), html);
// Same page for unknown paths (the demo routes in memory, so any path shows the app).
copyFileSync(join(out, "index.html"), join(out, "404.html"));
cpSync(join(web, "public", "icons"), join(out, "icons"), { recursive: true });
writeFileSync(join(out, ".nojekyll"), "");
writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log(`wrote ${out}`);
