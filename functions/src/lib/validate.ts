/**
 * Pure input checks for the callables (unit-tested in test/unit.spec.js). Mirrors web/src/model.ts.
 */
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"];
export const ROLE_KEYS = ["teamLeader", "officeManager", "spc", "intelWorker"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export interface RoleInput { name: string; email: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const cleanEmail = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return EMAIL_RE.test(e) && e.length <= 254 ? e : null;
};

export const cleanText = (raw: unknown, max: number): string =>
  typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";

/** Firestore document ids from clients: no slashes, no dunder names. */
export const isDocId = (raw: unknown): raw is string => typeof raw === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw) && !/^__.*__$/.test(raw);

/** Roles map → only known keys, each with a valid email (name may be blank → email prefix). */
export function cleanRoles(raw: unknown): { roles: Partial<Record<RoleKey, RoleInput>>; error: string | null } {
  const roles: Partial<Record<RoleKey, RoleInput>> = {};
  if (raw === undefined || raw === null) return { roles, error: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { roles, error: "Roles are invalid." };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ROLE_KEYS as readonly string[]).includes(k)) return { roles, error: `Unknown role ${k}.` };
    const r = (v ?? {}) as Record<string, unknown>;
    const name = cleanText(r.name, 80);
    const rawEmail = typeof r.email === "string" ? r.email.trim() : "";
    if (!rawEmail && !name) continue;
    const email = rawEmail ? cleanEmail(rawEmail) : "";
    if (email === null) return { roles, error: `Enter a valid email for ${k}.` };
    roles[k as RoleKey] = { name: name || (email ? email.split("@")[0] : ""), email };
  }
  return { roles, error: null };
}

export function cleanRisk(level: unknown, rationale: unknown, label: string): { level: string; rationale: string } {
  if (typeof level !== "string" || !RISK_LEVELS.includes(level)) throw new Error(`Choose a ${label} risk level.`);
  const r = cleanText(rationale, 2000);
  if (!r) throw new Error(`Enter a ${label} risk rationale.`);
  return { level, rationale: r };
}

export const AGREEMENT_METHODS = ["signup", "password", "passkey"];
