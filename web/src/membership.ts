/**
 * Who is part of a trip — web mirror of functions/src/lib/membership.ts (keep the two in step).
 * Used by the demo store (which does in the page what the Cloud Functions do in production) and
 * unit-tested. Sources: requester, role holders, flight passengers, additional access.
 */
export const ROLE_LABELS: Record<string, string> = {
  teamLeader: "Team Leader", officeManager: "Office Manager", spc: "SPC", intelWorker: "Intel Worker",
};

export interface Person { uid: string; name: string; email: string }
export interface AccessInput {
  requester: Person | null;
  roles: Record<string, { name?: string; email?: string; uid?: string | null } | undefined>;
  passengers: { flight: string; name: string; uid?: string | null; email?: string }[];
  extraUids: Person[];
  extraEmails: string[];
}
export interface AccessResult {
  memberUids: string[];
  pendingEmails: string[];
  members: Record<string, { name: string; email: string; reasons: string[] }>;
}

export function computeAccess(a: AccessInput): AccessResult {
  const members: AccessResult["members"] = {};
  const add = (uid: string | null | undefined, name: string, email: string, reason: string) => {
    if (!uid) return;
    const m = (members[uid] ??= { name: "", email: "", reasons: [] });
    if (!m.name && name) m.name = name;
    if (!m.email && email) m.email = email;
    if (!m.reasons.includes(reason)) m.reasons.push(reason);
  };
  const pending = new Set<string>();
  if (a.requester) add(a.requester.uid, a.requester.name, a.requester.email, "Requester");
  for (const [key, r] of Object.entries(a.roles)) {
    if (!r) continue;
    if (r.uid) add(r.uid, r.name ?? "", r.email ?? "", ROLE_LABELS[key] ?? key);
    else if (r.email) pending.add(r.email.toLowerCase());
  }
  for (const p of a.passengers) add(p.uid, p.name, p.email ?? "", `On flight ${p.flight}`.trim());
  for (const x of a.extraUids) add(x.uid, x.name, x.email, "Additional access");
  for (const e of a.extraEmails) pending.add(e.toLowerCase());
  return { memberUids: Object.keys(members).sort(), pendingEmails: [...pending].sort(), members };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Flight label used in "On flight …" reasons. */
export const flightLabel = (f: Record<string, unknown>) => [str(f.airline), str(f.flightNumber)].filter(Boolean).join(" ") || "flight";

