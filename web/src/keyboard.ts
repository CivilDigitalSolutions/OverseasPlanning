/**
 * Keep the field being typed in just above the on-screen keyboard (owner, 2026-11-10).
 *
 * Phones show the keyboard over the page. iOS never resizes the page for it, and Android only
 * does when told to (index.html: interactive-widget=resizes-content). So on touch devices:
 *  - the visible area (visualViewport) is published as CSS variables --vvh / --vvt, which the
 *    pop-up forms use to fit above the keyboard instead of behind it;
 *  - when a text field gains focus, once the keyboard has opened, the nearest scrolling container
 *    (a pop-up form or the page) is scrolled so the field's bottom sits just above the keyboard.
 *
 * Inside an embedding frame (e.g. the claude.ai app on Android) the page is NOT told about the
 * keyboard at all: the visible area never shrinks. When no shrink is seen, the keyboard is assumed
 * to cover the lower ASSUMED_KEYBOARD share of the frame, and extra space is added at the bottom
 * (html.kb-open) so even the last field on a page or form can be lifted above it.
 */

const GAP = 12; // px between the field and the top of the keyboard
const TOP_CLEARANCE = 72; // never push a field under the sticky header
/** Share of the screen a phone keyboard covers when the page can't measure it. */
export const ASSUMED_KEYBOARD = 0.45;
/** A real keyboard shrinks the visible area by at least this much. */
const KEYBOARD_MIN_PX = 120;

/**
 * The visible height to plan for: the measured one when a keyboard shrink was seen, otherwise the
 * frame height minus the assumed keyboard. Pure, so it is unit-tested.
 */
export function plannedVisibleHeight(measured: number, tallestSeen: number): number {
  if (tallestSeen - measured >= KEYBOARD_MIN_PX) return measured; // real keyboard measured
  return Math.round(measured * (1 - ASSUMED_KEYBOARD));
}

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

let tallest = 0;
const measuredHeight = () => (window.visualViewport ? window.visualViewport.height : window.innerHeight);

function reveal(el: HTMLElement) {
  if (document.activeElement !== el) return;
  const vv = window.visualViewport;
  const visibleTop = vv ? vv.offsetTop : 0;
  const visibleHeight = plannedVisibleHeight(measuredHeight(), tallest);
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
  tallest = measuredHeight();
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
  const html = document.documentElement;
  document.addEventListener("focusin", (e) => {
    if (!isTextField(e.target as Element)) return;
    html.classList.add("kb-open"); // room below the last field, so it can be lifted
    schedule(e.target as HTMLElement);
  });
  document.addEventListener("focusout", () => {
    // Remove the extra room once focus has really left text fields (not just moved between them).
    window.setTimeout(() => { if (!isTextField(document.activeElement)) html.classList.remove("kb-open"); }, 250);
  });
  const onResize = () => {
    // Only a growing visible area raises the baseline (rotation, keyboard closing).
    if (!isTextField(document.activeElement)) tallest = measuredHeight();
    else tallest = Math.max(tallest, measuredHeight());
    publish();
    const el = document.activeElement;
    if (isTextField(el)) schedule(el);
  };
  vv?.addEventListener("resize", onResize);
  vv?.addEventListener("scroll", publish);
  window.addEventListener("resize", onResize);
}
