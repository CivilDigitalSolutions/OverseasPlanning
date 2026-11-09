import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// ---- Router (tiny: pathname + history API) ---------------------------------------------------------

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path); else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [p, setP] = useState(location.pathname + location.search);
  useEffect(() => {
    const on = () => setP(location.pathname + location.search);
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
export function Modal({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.icon-btn)");
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; prev?.focus?.(); };
  }, [onClose]);
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
  check: "M5 12l5 5 9-10",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  logout: "M10 5H5v14h5M14 8l4 4-4 4M18 12H9",
  key: "M15 8a4 4 0 11-3.9 4.8L4 13v3h3v2h3l1.3-1.3A4 4 0 0115 8z",
  pdf: "M6 3h8l4 4v14H6zM9 13h6M9 17h4",
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
