/**
 * Talks to the Laravel API on the SAME origin (/api/v1), with Sanctum's SPA session cookie and
 * CSRF token. No tokens are ever stored by the app (SECURITY-PLAN §6.3).
 *
 * Live data uses one SHARED polling layer (MIGRATION-PLAN §3 / review item 9): identical paths
 * are fetched once for every screen that shows them, only while the app is visible, and polling
 * stops for a path that answers 403/404 (review item 5). Background polls send
 * `X-Background-Poll: 1` so they never keep an idle session alive (review item 2).
 */
import { useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = "") { super(message); }
}

const BASE = "/api/v1/";
let csrfReady: Promise<void> | null = null;

function xsrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/** Fetch the CSRF cookie once (and again after sign-in/out, which rotates it). */
export function resetCsrf() { csrfReady = null; }
async function ensureCsrf() {
  if (xsrfToken()) return;
  csrfReady ??= fetch("/sanctum/csrf-cookie", { credentials: "same-origin" }).then(() => undefined);
  await csrfReady;
}

const sessionListeners = new Set<() => void>();
/** Called when the server says the session is gone (expired, signed out elsewhere, disabled). */
export const onSessionLost = (fn: () => void) => { sessionListeners.add(fn); return () => sessionListeners.delete(fn); };

export async function api<T>(method: string, path: string, body?: unknown, opts: { background?: boolean; form?: FormData } = {}): Promise<T> {
  const write = method !== "GET";
  if (write) await ensureCsrf();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (write) headers["X-XSRF-TOKEN"] = xsrfToken();
  if (opts.background) headers["X-Background-Poll"] = "1";
  if (body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method, headers, credentials: "same-origin", cache: "no-store",
      body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, "No connection. Try again.");
  }
  if (res.status === 419 && write) { // CSRF token rotated: fetch a fresh one and retry once
    resetCsrf();
    document.cookie = "XSRF-TOKEN=; Max-Age=0; path=/";
    return api<T>(method, path, body, opts);
  }
  const json = res.headers.get("Content-Type")?.includes("application/json") ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    if (res.status === 401 && path !== "auth/session") sessionListeners.forEach((f) => f());
    const first = json.errors ? Object.values(json.errors as Record<string, string[] | string>)[0] : null;
    const msg = (Array.isArray(first) ? first[0] : first) || json.message || "Something went wrong.";
    throw new ApiError(res.status, String(msg), String(json.code ?? ""));
  }
  return json as T;
}

// ---- shared polling ------------------------------------------------------------------------------

interface Entry { data: unknown; subs: Set<(d: unknown) => void>; timer: number | null; interval: number; stopped: boolean; inflight: boolean }
const entries = new Map<string, Entry>();

async function load(path: string, background: boolean) {
  const e = entries.get(path);
  if (!e || e.inflight || e.stopped) return;
  e.inflight = true;
  try {
    e.data = await api("GET", path, undefined, { background });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 403 || err.status === 404)) { e.data = { __error: err.status }; e.stopped = true; }
    else if (e.data === undefined) e.data = { __error: err instanceof ApiError ? err.status : 0 };
  } finally {
    e.inflight = false;
  }
  e.subs.forEach((f) => f(e.data));
}

function schedule(path: string) {
  const e = entries.get(path);
  if (!e || e.timer !== null) return;
  e.timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(path, true); }, e.interval);
}

/** Re-fetch now every polled path starting with any of the prefixes (after a change). */
export function refresh(...prefixes: string[]) {
  for (const [path, e] of entries) if (prefixes.some((p) => path.startsWith(p))) { e.stopped = false; void load(path, false); }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") for (const p of entries.keys()) void load(p, true); });
}

/**
 * Subscribe to a polled path. `map` turns the JSON into the screen's shape; `fallback` is used
 * when the server refuses (403/404) or cannot be reached on first load.
 */
export function usePoll<T>(path: string | null, map: (json: any) => T, fallback: T, intervalMs = 20_000): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!path) { setValue(fallback); return; }
    let e = entries.get(path);
    if (!e) { e = { data: undefined, subs: new Set(), timer: null, interval: intervalMs, stopped: false, inflight: false }; entries.set(path, e); }
    e.interval = Math.min(e.interval, intervalMs);
    const apply = (d: unknown) => setValue(d && typeof d === "object" && "__error" in d ? fallback : map(d));
    e.subs.add(apply);
    if (e.data !== undefined) apply(e.data);
    if (e.data === undefined || e.subs.size === 1) void load(path, false);
    schedule(path);
    return () => {
      const cur = entries.get(path);
      if (!cur) return;
      cur.subs.delete(apply);
      if (cur.subs.size === 0) { if (cur.timer !== null) window.clearInterval(cur.timer); entries.delete(path); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, intervalMs]);
  return value;
}

/** Drop every cached response (sign-out / account switch). */
export function clearPolls() {
  for (const e of entries.values()) if (e.timer !== null) window.clearInterval(e.timer);
  entries.clear();
}
