// Renders public/icons/icon.svg to the PNG sizes the PWA manifest and iOS need, using the
// pre-installed Playwright Chromium. Run: npm run icons
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(dir, "icon.svg"), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
const shots = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["apple-touch-icon.png", 180, 0],
  // Maskable: artwork inside the 80% safe zone on a full-bleed background.
  ["icon-maskable-512.png", 512, 0.1],
];
for (const [name, size, pad] of shots) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#13294B;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: join(dir, name), omitBackground: false });
}
await browser.close();
console.log("icons written to", dir);
