/**
 * Keep the field being typed in just above the on-screen keyboard (owner, 2026-11-10).
 *
 * Phones show the keyboard over the page. iOS never resizes the page for it, and Android only
 * does when told to (index.html: interactive-widget=resizes-content). So on touch devices:
 *  - the visible area (visualViewport) is published as CSS variables --vvh / --vvt, which the
 *    pop-up forms use to fit above the keyboard instead of behind it;
 *  - when a text field gains focus, once the keyboard has opened, the nearest scrolling container
 *    (a pop-up form or the page) is scrolled so the field's bottom sits just above the keyboard.
 */

const GAP = 12; // px between the field and the top of the keyboard
const TOP_CLEARANCE = 72; // never push a field under the sticky header

/**
 * How far to scroll (positive = down) so a field spanning [top, bottom] in viewport coordinates
 * ends just above the keyboard, given the visible area [visibleTop, visibleTop + visibleHeight].
 * 0 when it is already comfortably visible. Pure, so it is unit-tested.
 */
export function scrollDeltaFor(top: number, bottom: number, visibleTop: number, visibleHeight: number): number {
  const limit = visibleTop + visibleHeight - GAP;
  if (bottom > limit) {
    // Below the keyboard line: bring the bottom up to it, unless that would hide the top.
    const delta = bottom - limit;
    const maxDelta = top - (visibleTop + TOP_CLEARANCE);
    return Math.max(0, bottom - top > visibleHeight - TOP_CLEARANCE ? maxDelta : delta);
  }
  if (top < visibleTop + TOP_CLEARANCE) return top - (visibleTop + TOP_CLEARANCE); // above: scroll up
  return 0;
}

const isTextField = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(el.type);
  return (el as HTMLElement).isContentEditable;
};

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function reveal(el: HTMLElement) {
  if (document.activeElement !== el) return;
  const vv = window.visualViewport;
  const visibleTop = vv ? vv.offsetTop : 0;
  const visibleHeight = vv ? vv.height : window.innerHeight;
  // A text field's own label sits just above it; keep the label in view too.
  const box = (el.closest(".field") as HTMLElement | null) ?? el;
  const r = box.getBoundingClientRect();
  const delta = scrollDeltaFor(r.top, r.bottom, visibleTop, visibleHeight);
  if (Math.abs(delta) < 2) return;
  const parent = scrollParent(el);
  if (parent) parent.scrollBy({ top: delta, behavior: "smooth" });
  else window.scrollBy({ top: delta, behavior: "smooth" });
}

let installed = false;
export function installKeyboardAvoidance() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const touch = window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  if (!touch) return;

  const vv = window.visualViewport;
  const publish = () => {
    const root = document.documentElement.style;
    root.setProperty("--vvh", `${vv ? vv.height : window.innerHeight}px`);
    root.setProperty("--vvt", `${vv ? vv.offsetTop : 0}px`);
  };
  publish();

  let timers: number[] = [];
  const schedule = (el: HTMLElement) => {
    timers.forEach(clearTimeout);
    // The keyboard animates in over ~250-400 ms; check as it settles.
    timers = [120, 350, 650].map((ms) => window.setTimeout(() => reveal(el), ms));
  };
  document.addEventListener("focusin", (e) => { if (isTextField(e.target as Element)) schedule(e.target as HTMLElement); });
  const onResize = () => {
    publish();
    const el = document.activeElement;
    if (isTextField(el)) schedule(el);
  };
  vv?.addEventListener("resize", onResize);
  vv?.addEventListener("scroll", publish);
  window.addEventListener("resize", onResize);
}
