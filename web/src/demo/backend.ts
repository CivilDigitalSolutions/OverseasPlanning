/**
 * Demo backend: a tiny Firestore-shaped adapter used ONLY by the artifact demo build.
 *
 *  - "shared": the artifact's `db` capability — everyone with access sees the same trips live.
 *  - "local": when that isn't available (signed out, outside the organisation), data lives in this
 *    browser only (memory + localStorage), so the demo still works on its own.
 *
 * Paths mirror the production Firestore model (docs/SPEC.md §4). Timestamps are epoch ms.
 */

export interface Snap { id: string; data: Record<string, unknown>; pending: boolean }
export type Unsub = () => void;
export const DELETE = "__delete__";

export interface Backend {
  mode: "shared" | "local";
  uid: string;
  watchCollection(path: string, q: QuerySpec, cb: (docs: Snap[]) => void, onErr?: () => void): Unsub;
  watchDoc(path: string, cb: (d: Snap | null) => void, onErr?: () => void): Unsub;
  get(path: string): Promise<Snap | null>;
  list(path: string, q?: QuerySpec): Promise<Snap[]>;
  set(path: string, data: Record<string, unknown>): Promise<void>;
  /** Shallow merge; a value of DELETE removes that field. Creates the document if missing. */
  patch(path: string, data: Record<string, unknown>): Promise<void>;
  del(path: string): Promise<void>;
  newId(): string;
  assets: Assets | null;
  downloads: Downloads | null;
}
export interface QuerySpec { where?: [string, string, unknown][]; orderBy?: [string, "asc" | "desc"] }
export interface Assets { upload(b: Blob): Promise<{ id: string; url: string }>; delete(id: string): Promise<void> }
export interface Downloads { save(o: { filename: string; data: Blob }): Promise<unknown> }

const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

function applyPatch(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v === DELETE) delete next[k]; else next[k] = v; }
  return next;
}

function matches(d: Record<string, unknown>, q: QuerySpec): boolean {
  return (q.where ?? []).every(([f, op, v]) => {
    const x = d[f];
    if (op === "==") return x === v;
    if (op === "array-contains") return Array.isArray(x) && x.includes(v);
    return true;
  });
}
function order(list: Snap[], q: QuerySpec): Snap[] {
  if (!q.orderBy) return list;
  const [f, dir] = q.orderBy;
  return [...list].sort((a, b) => {
    const x = a.data[f] as number | string | undefined, y = b.data[f] as number | string | undefined;
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
  });
}

// ---- shared (artifact db) ---------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function sharedBackend(db: any, uid: string, assets: Assets | null, downloads: Downloads | null): Backend {
  const build = (path: string, q: QuerySpec) => {
    let ref = db.collection(path);
    for (const [f, op, v] of q.where ?? []) ref = ref.where(f, op, v);
    if (q.orderBy) ref = ref.orderBy(q.orderBy[0], q.orderBy[1]);
    return ref;
  };
  const toSnap = (d: any): Snap => ({ id: d.id, data: { ...(d.data() ?? {}) }, pending: !!d.metadata?.hasPendingWrites });
  // Serialise writes per document (the store asks for one write at a time per doc).
  const chains = new Map<string, Promise<unknown>>();
  const queue = <T,>(path: string, fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(path) ?? Promise.resolve()).catch(() => undefined).then(fn);
    chains.set(path, run);
    return run;
  };
  return {
    mode: "shared", uid, assets, downloads,
    watchCollection: (path, q, cb, onErr) => build(path, q).onSnapshot((s: any) => cb(s.docs.map(toSnap)), () => onErr?.()),
    watchDoc: (path, cb, onErr) => db.doc(path).onSnapshot((d: any) => cb(d.exists ? toSnap(d) : null), () => onErr?.()),
    get: async (path) => { const d = await db.doc(path).get(); return d.exists ? toSnap(d) : null; },
    list: async (path, q = {}) => (await build(path, q).get()).docs.map(toSnap),
    set: (path, data) => queue(path, () => db.doc(path).set(data)),
    patch: (path, data) => queue(path, async () => {
      const d = await db.doc(path).get();
      await db.doc(path).set(applyPatch(d.exists ? { ...d.data() } : {}, data));
    }),
    del: (path) => queue(path, () => db.doc(path).delete()),
    newId: rid,
  };
}

// ---- local (this browser only) ------------------------------------------------------------------

const KEY = "op.demo.local";
function localBackend(uid: string, downloads: Downloads | null): Backend {
  let docs = new Map<string, Record<string, unknown>>();
  try { docs = new Map(Object.entries(JSON.parse(localStorage.getItem(KEY) ?? "{}"))); } catch { /* fresh */ }
  const listeners = new Set<() => void>();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(docs))); } catch { /* ignore */ } };
  const notify = () => { save(); queueMicrotask(() => listeners.forEach((l) => l())); };
  const inColl = (path: string) => [...docs.entries()]
    .filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
    .map(([p, data]) => ({ id: p.slice(path.length + 1), data: { ...data }, pending: false }));
  const listQ = (path: string, q: QuerySpec) => order(inColl(path).filter((s) => matches(s.data, q)), q);
  const blobs = new Map<string, Blob>();
  return {
    mode: "local", uid, downloads,
    assets: {
      upload: async (b) => { const id = rid(); blobs.set(id, b); return { id, url: URL.createObjectURL(b) }; },
      delete: async (id) => { blobs.delete(id); },
    },
    watchCollection: (path, q, cb) => {
      const l = () => cb(listQ(path, q));
      listeners.add(l); queueMicrotask(l);
      return () => listeners.delete(l);
    },
    watchDoc: (path, cb) => {
      const l = () => { const d = docs.get(path); cb(d ? { id: path.split("/").pop()!, data: { ...d }, pending: false } : null); };
      listeners.add(l); queueMicrotask(l);
      return () => listeners.delete(l);
    },
    get: async (path) => { const d = docs.get(path); return d ? { id: path.split("/").pop()!, data: { ...d }, pending: false } : null; },
    list: async (path, q = {}) => listQ(path, q),
    set: async (path, data) => { docs.set(path, { ...data }); notify(); },
    patch: async (path, data) => { docs.set(path, applyPatch(docs.get(path) ?? {}, data)); notify(); },
    del: async (path) => { docs.delete(path); notify(); },
    newId: rid,
  };
}

// ---- init ---------------------------------------------------------------------------------------

let backend: Backend | null = null;
export const be = (): Backend => { if (!backend) throw new Error("Demo backend not ready"); return backend; };

export async function initBackend(): Promise<Backend> {
  const claude = (window as any).claude;
  const use = async (name: string) => { try { return claude?.use ? await claude.use(name) : null; } catch { return null; } };
  const [db, user, assets, downloads] = await Promise.all([use("db"), use("user"), use("assets"), use("downloads")]);
  const id: string | null = user ? await user.id().catch(() => null) : null;
  if (db && id) {
    try {
      await db.collection("accounts").limit(1).get();
      backend = sharedBackend(db, id, assets, downloads);
      return backend;
    } catch { /* fall through to local */ }
  }
  let localId = "";
  try { localId = localStorage.getItem("op.demo.uid") ?? ""; } catch { /* ignore */ }
  if (!localId) { localId = `local-${rid()}`; try { localStorage.setItem("op.demo.uid", localId); } catch { /* ignore */ } }
  backend = localBackend(localId, downloads);
  return backend;
}
