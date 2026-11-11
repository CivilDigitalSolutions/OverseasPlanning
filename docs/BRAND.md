# Voyager Trip Manager — brand

Owner decision 2026-11-11: the app is **Voyager** ("VOYAGER / TRIP MANAGER"), black-and-white
artwork as on `brand/voyager-brand-board.jpg`.

| Asset | Where | Used for |
|---|---|---|
| Emblem (black / white, transparent) | `web/src/assets/emblem-*.png` | Sign-in screens, top bar, splash, PDF header |
| Wordmark (black / white, transparent) | `web/src/assets/wordmark-*.png` | Sign-in screens, top bar, splash |
| App icon 192 / 512 (white emblem, black rounded square) | `web/public/icons/icon-*.png` | Installed app (PWA manifest) |
| Maskable 512 (full-bleed black, emblem in the safe zone) | `web/public/icons/icon-maskable-512.png` | Android adaptive icon |
| Apple touch icon 180 | `web/public/icons/apple-touch-icon.png` | iPhone / iPad Home Screen |
| Favicons 16/32/48/64 + `.ico` | `web/public/icons/favicon*` | Browser tabs, bookmarks |
| Notification badge 96 (white on transparent) | `web/public/icons/badge-96.png` | Android notification bar |
| Share image 1200×630 | `web/public/icons/og-image.png` | Link previews |

Regenerate everything from the board: `npm --prefix web run icons` (needs Python + Pillow).
The emblem and wordmark are traced from the board image, so a vector original from the designer
would give sharper large prints — drop it in `brand/` and point the script at it.
TODO(owner): vector (SVG) originals of the emblem and wordmark.

UI colours: the top bar, splash, install prompt and theme colour are brand black; the rest of the
interface keeps its existing blue accents for buttons and links.
