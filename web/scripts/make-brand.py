"""Generate the Voyager logo assets and every icon from the brand board.

Run from the repo root:  python3 web/scripts/make-brand.py web/public/icons web/src/assets
Crop boxes are pixel positions of the emblem and wordmark on brand/voyager-brand-board.jpg."""
import sys
from PIL import Image, ImageDraw, ImageFilter
SRC = sys.argv[3] if len(sys.argv) > 3 else "brand/voyager-brand-board.jpg"
OUT_ICONS, OUT_SRC = sys.argv[1], sys.argv[2]
src = Image.open(SRC).convert("L")

def mark(box, scale=4, pad=6):
    """Crop, upscale, and turn dark ink into an alpha mask (light grid/background → transparent)."""
    x0, y0, x1, y1 = box
    reg = src.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad))
    reg = reg.resize((reg.width * scale, reg.height * scale), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
    lo, hi = 95, 205  # ink below lo = solid, above hi = background (grid lines are ~225+)
    alpha = reg.point(lambda v: 255 if v <= lo else 0 if v >= hi else int((hi - v) * 255 / (hi - lo)))
    return alpha.crop(alpha.getbbox())

def colour(alpha, rgb):
    im = Image.new("RGBA", alpha.size, rgb + (0,)); im.putalpha(alpha); return im

emblem = mark((252, 58, 468, 257))
word = mark((165, 283, 540, 378))
for name, a in (("emblem", emblem), ("wordmark", word)):
    colour(a, (0, 0, 0)).save(f"{OUT_SRC}/{name}-black.png", optimize=True)
    colour(a, (255, 255, 255)).save(f"{OUT_SRC}/{name}-white.png", optimize=True)

def icon(size, bg, fg, radius=0.0, fill=0.74, transparent_outside=True):
    """Square icon: emblem centred on a (rounded) square."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0) if transparent_outside else bg + (255,))
    if transparent_outside:
        ImageDraw.Draw(im).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * radius), fill=bg + (255,))
    w = int(size * fill); h = int(w * emblem.height / emblem.width)
    if h > size * fill: h = int(size * fill); w = int(h * emblem.width / emblem.height)
    e = colour(emblem.resize((w, h), Image.LANCZOS), fg)
    im.alpha_composite(e, ((size - w) // 2, (size - h) // 2))
    return im

BLACK, WHITE = (0, 0, 0), (255, 255, 255)
icon(192, BLACK, WHITE, radius=0.22).save(f"{OUT_ICONS}/icon-192.png", optimize=True)
icon(512, BLACK, WHITE, radius=0.22).save(f"{OUT_ICONS}/icon-512.png", optimize=True)
# Maskable: full-bleed background, emblem inside the 80% safe zone.
icon(512, BLACK, WHITE, fill=0.58, transparent_outside=False).save(f"{OUT_ICONS}/icon-maskable-512.png", optimize=True)
# iOS rounds the corners itself: full square.
icon(180, BLACK, WHITE, fill=0.74, transparent_outside=False).convert("RGB").save(f"{OUT_ICONS}/apple-touch-icon.png", optimize=True)
# Browser tab icons.
for s in (16, 32, 48, 64):
    icon(s, BLACK, WHITE, radius=0.18, fill=0.86).save(f"{OUT_ICONS}/favicon-{s}.png", optimize=True)
icon(256, BLACK, WHITE, radius=0.18, fill=0.86).save(f"{OUT_ICONS}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
# Android notification badge: white emblem on transparent (Android uses only the alpha).
b = Image.new("RGBA", (96, 96), (0, 0, 0, 0)); e = colour(emblem.resize((84, int(84 * emblem.height / emblem.width)), Image.LANCZOS), WHITE)
b.alpha_composite(e, ((96 - e.width) // 2, (96 - e.height) // 2)); b.save(f"{OUT_ICONS}/badge-96.png", optimize=True)
# Small in-app logo (data URI in the header / sign-in): 128px app icon.
icon(128, BLACK, WHITE, radius=0.22).save(f"{OUT_SRC}/app-icon-128.png", optimize=True)
# Social / install preview image.
og = Image.new("RGBA", (1200, 630), WHITE + (255,))
e = colour(emblem.resize((300, int(300 * emblem.height / emblem.width)), Image.LANCZOS), BLACK)
og.alpha_composite(e, ((1200 - e.width) // 2, 90))
wm = colour(word.resize((560, int(560 * word.height / word.width)), Image.LANCZOS), BLACK)
og.alpha_composite(wm, ((1200 - wm.width) // 2, 90 + e.height + 40))
og.convert("RGB").save(f"{OUT_ICONS}/og-image.png", optimize=True)
print("emblem", emblem.size, "wordmark", word.size)
