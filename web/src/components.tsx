import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

// ---- Router (tiny: pathname + history API) ---------------------------------------------------------

/** The demo build (an artifact frame) can't use real URLs, so it routes in memory. */
const MEMORY = import.meta.env.VITE_DEMO === "1";
let memoryPath = "/";

export function navigate(path: string, replace = false) {
  if (MEMORY) memoryPath = path;
  else if (replace) history.replaceState(null, "", path); else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export const currentPath = () => (MEMORY ? memoryPath : location.pathname + location.search);

export function usePath(): string {
  const [p, setP] = useState(currentPath);
  useEffect(() => {
    const on = () => setP(currentPath());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return p;
}

/** Internal link that uses the router instead of a page load. */
export function Link({ to, children, className, current }: { to: string; children: ReactNode; className?: string; current?: boolean }) {
  return (
    <a href={to} className={className} aria-current={current ? "page" : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(to); }}>
      {children}
    </a>
  );
}

// ---- Form fields: a header label + hint text inside the input. No other descriptive text. ----------

interface BaseProps { label: string; error?: string; hint?: string; required?: boolean }

export function TextField(p: BaseProps & {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoComplete?: string;
  multiline?: boolean; rows?: number; maxLength?: number; inputMode?: "text" | "decimal" | "numeric" | "email"; disabled?: boolean;
}) {
  const id = useId();
  if (p.type === "date" || p.type === "datetime-local") return <DateField {...p} withTime={p.type === "datetime-local"} />;
  const common = {
    id, value: p.value, placeholder: p.placeholder, maxLength: p.maxLength, disabled: p.disabled, required: p.required,
    "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? `${id}-e` : undefined,
  } as const;
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      {p.multiline
        ? <textarea {...common} rows={p.rows ?? 4} onChange={(e) => p.onChange(e.target.value)} />
        : <input {...common} type={p.type ?? "text"} autoComplete={p.autoComplete} inputMode={p.inputMode} onChange={(e) => p.onChange(e.target.value)} />}
      {p.hint && <span className="hint">{p.hint}</span>}
      {p.error && <span className="error" id={`${id}-e`} role="alert">{p.error}</span>}
    </div>
  );
}

export function SelectField(p: BaseProps & { value: string; onChange: (v: string) => void; options: readonly (string | { value: string; label: string })[]; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      <select id={id} value={p.value} onChange={(e) => p.onChange(e.target.value)} disabled={p.disabled} aria-invalid={p.error ? true : undefined}>
        <option value="">{p.placeholder ?? "Select…"}</option>
        {p.options.map((o) => typeof o === "string"
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {p.error && <span className="error" role="alert">{p.error}</span>}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ---- Bits ---------------------------------------------------------------------------------------

export const Badge = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={`badge ${tone ?? ""}`}>{children}</span>;

export const Notice = ({ tone, children }: { tone?: "bad" | "ok" | "warn"; children: ReactNode }) =>
  <div className={`notice ${tone ?? ""}`} role={tone === "bad" ? "alert" : "status"}>{children}</div>;

export const Loading = () => <div className="empty" aria-busy="true">Loading…</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

/** Dialog with focus trap-lite: focuses itself, Esc closes, backdrop click closes. */
/** Open dialogs, innermost last: Escape closes only the top one (a date picker inside a form). */
const modalStack: string[] = [];

export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.icon-btn)");
    (first ?? ref.current)?.focus();
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modalStack[modalStack.length - 1] === id) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
      if (modalStack.length === 0) document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [onClose, id]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, confirmLabel, danger, onConfirm, onClose, children }: {
  title: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn secondary" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? "danger" : ""}`} disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        try { await onConfirm(); onClose(); } catch (e) { setErr(errorText(e)); setBusy(false); }
      }}>{confirmLabel}</button>
    </>}>
      {children}
      {err && <Notice tone="bad">{err}</Notice>}
    </Modal>
  );
}

/** Friendly error text from Firebase / callable errors. */
export function errorText(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  if (code.includes("permission-denied")) return "You don't have permission to do that.";
  if (code.includes("unavailable") || code.includes("network")) return "No connection. Try again.";
  if (code.startsWith("functions/") && msg && !/^internal$/i.test(msg)) return msg;
  return msg || "Something went wrong.";
}

// ---- Icons (inline SVG, no icon font) ------------------------------------------------------------

const PATHS: Record<string, string> = {
  close: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  send: "M4 12l16-8-6 16-2-7-8-1z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  edit: "M4 20h4L19 9l-4-4L4 16v4z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  check: "M5 12l5 5 9-10",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  logout: "M10 5H5v14h5M14 8l4 4-4 4M18 12H9",
  key: "M15 8a4 4 0 11-3.9 4.8L4 13v3h3v2h3l1.3-1.3A4 4 0 0115 8z",
  pdf: "M6 3h8l4 4v14H6zM9 13h6M9 17h4",
  cog: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 01-1.7 1l-.3 2h-4l-.3-2a7 7 0 01-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 010-3L3 9.3l2-3.4 1.9.7a7 7 0 011.7-1l.3-2h4l.3 2a7 7 0 011.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 010 3z",
  bell: "M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0",
  book: "M4 4.5A1.5 1.5 0 015.5 3H20v15H5.5A1.5 1.5 0 004 19.5v-15zM4 19.5A1.5 1.5 0 005.5 21H20M8 7h8M8 10.5h6",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export const relTime = (ms: number) => {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

// ---- Calendar date picker (owner, 2026-11-12): every date is picked from a calendar ---------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayParts = () => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; };

/** "12 Nov 2026" / "12 Nov 2026, 21:10" (UK order). */
export function formatPicked(v: string, withTime: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
  if (!m) return "";
  const date = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)} ${m[1]}`;
  return withTime && m[4] ? `${date}, ${m[4]}:${m[5]}` : date;
}

/** The days shown for a month: leading blanks so the 1st falls on its weekday (weeks start Monday). */
export function monthCells(y: number, m: number): (number | null)[] {
  const first = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  return [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

function DateField(p: BaseProps & { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; withTime: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = formatPicked(p.value, p.withTime);
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      <button id={id} type="button" className="date-input" disabled={p.disabled} onClick={() => setOpen(true)}
        aria-invalid={p.error ? true : undefined} aria-describedby={p.error ? `${id}-e` : undefined} aria-haspopup="dialog">
        <span className={shown ? "" : "placeholder"}>{shown || (p.withTime ? "Select date and time" : "Select date")}</span>
        <Icon name="calendar" size={18} />
      </button>
      {p.hint && <span className="hint">{p.hint}</span>}
      {p.error && <span className="error" id={`${id}-e`} role="alert">{p.error}</span>}
      {open && <CalendarDialog title={p.label.replace(/\s*\*$/, "")} value={p.value} withTime={p.withTime}
        onClose={() => setOpen(false)} onPick={(v) => { p.onChange(v); setOpen(false); }} />}
    </div>
  );
}

function CalendarDialog({ title, value, withTime, onClose, onPick }: {
  title: string; value: string; withTime: boolean; onClose: () => void; onPick: (v: string) => void;
}) {
  const now = todayParts();
  const cur = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  const [view, setView] = useState({ y: cur ? Number(cur[1]) : now.y, m: cur ? Number(cur[2]) - 1 : now.m });
  const [day, setDay] = useState<string>(cur ? `${cur[1]}-${cur[2]}-${cur[3]}` : "");
  const [hh, setHh] = useState(cur?.[4] ?? "09");
  const [mm, setMm] = useState(cur?.[5] ?? "00");
  const move = (delta: number) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const years = Array.from({ length: 31 }, (_, i) => now.y - 20 + i);
  if (!years.includes(view.y)) years.push(view.y);
  const pick = (d: string) => (withTime ? setDay(d) : onPick(d));
  const today = isoOf(now.y, now.m, now.d);
  return (
    <Modal title={title} onClose={onClose} actions={<>
      <button className="btn ghost" onClick={() => onPick("")}>Clear</button>
      {!withTime && <button className="btn secondary" onClick={() => onPick(today)}>Today</button>}
      {withTime && <button className="btn" disabled={!day} onClick={() => onPick(`${day}T${hh}:${mm}`)}>Done</button>}
    </>}>
      <div className="calendar">
        <div className="cal-head">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(-1)}><Icon name="back" /></button>
          <select aria-label="Month" value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>
            {MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select aria-label="Year" value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>
            {years.sort((a, b) => a - b).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button type="button" className="icon-btn" aria-label="Next month" onClick={() => move(1)}><Icon name="next" /></button>
        </div>
        <div className="cal-grid" role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`}>
          {DAYS.map((d) => <span key={d} className="cal-dow" aria-hidden="true">{d}</span>)}
          {monthCells(view.y, view.m).map((d, i) => {
            if (d === null) return <span key={`b${i}`} />;
            const iso = isoOf(view.y, view.m, d);
            return (
              <button key={iso} type="button" className={`cal-day${iso === today ? " today" : ""}`} aria-pressed={iso === day}
                aria-label={formatPicked(iso, false)} onClick={() => pick(iso)}>{d}</button>
            );
          })}
        </div>
        {withTime && (
          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: "end" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cal-hh">Hour</label>
              <select id="cal-hh" value={hh} onChange={(e) => setHh(e.target.value)}>
                {Array.from({ length: 24 }, (_, i) => pad2(i)).map((h) => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="cal-mm">Minute</label>
              <select id="cal-mm" value={mm} onChange={(e) => setMm(e.target.value)}>
                {Array.from({ length: 60 }, (_, i) => pad2(i)).map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- Scrollable tab strip (owner, 2026-11-12) ------------------------------------------------------

/**
 * A row of tabs that scrolls sideways on any screen: ‹ › buttons appear when tabs are hidden that
 * way, a mouse wheel scrolls the row, the selected tab is kept in view, and ← → move between tabs.
 */
export function ScrollTabs({ label, activeKey, children }: { label: string; activeKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    // An up/down mouse wheel scrolls the row sideways while there is more to see that way.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const atEnd = e.deltaY > 0 ? el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 : el.scrollLeft <= 0;
      if (atEnd) return; // let the page scroll once the row is at its end
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); el.removeEventListener("wheel", onWheel); ro?.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    const el = ref.current;
    const sel = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !sel) return;
    const l = sel.offsetLeft - el.offsetLeft;
    if (l < el.scrollLeft + 24) el.scrollTo({ left: Math.max(0, l - 40) });
    else if (l + sel.offsetWidth > el.scrollLeft + el.clientWidth - 24) el.scrollTo({ left: l + sel.offsetWidth - el.clientWidth + 40 });
  }, [activeKey]);

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.7), behavior: "smooth" });
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const tabs = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="tabs-wrap">
      {edges.left && <button type="button" className="tab-scroll left" tabIndex={-1} aria-label="Scroll tabs left" onClick={() => page(-1)}><Icon name="back" size={18} /></button>}
      <div className="tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKeyDown}>{children}</div>
      {edges.right && <button type="button" className="tab-scroll right" tabIndex={-1} aria-label="Scroll tabs right" onClick={() => page(1)}><Icon name="next" size={18} /></button>}
    </div>
  );
}
