/**
 * Who is part of a trip (owner decision 2026-11-10) — the ONLY source of `trips.memberUids`:
 *   - the person who submitted the trip request,
 *   - everyone named in a role (Team Leader, Office Manager, SPC, Intel Worker),
 *   - everyone booked on a flight (passengers picked from the in-app directory carry a uid),
 *   - everyone given additional access (`extraAccessUids`; emails without an account wait in
 *     `extraAccessEmails` until that person signs up).
 * HOST sees every trip through the `host` claim and controllers see live trips through theirs;
 * neither needs to be in memberUids.
 *
 * Access is RECOMPUTED from these sources after every change, so someone taken off a role or a
 * flight loses access unless they are still part of the trip some other way.
 * Mirrored for the demo in web/src/membership.ts — keep the two in step.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { notify, recipients } from "./notify";

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

/**
 * Recompute and store a trip's membership. Idempotent; safe to call after any change.
 * Older trips without `extraAccessUids` keep everyone they already had as additional access.
 */
export interface RecomputeOptions {
  /** Whoever made the change (not notified about their own action). */
  actor?: string | null;
  /** People the caller will notify itself (e.g. "booked on flight" covers "added to trip"). */
  skipNotify?: string[];
}

/**
 * Recompute and store a trip's membership, then tell newly added people they're on the trip.
 * Idempotent; safe to call after any change.
 */
export async function recomputeTripAccess(db: Firestore, tripId: string, opts: RecomputeOptions = {}): Promise<(AccessResult & { added: string[] }) | null> {
  const ref = db.collection("trips").doc(tripId);
  const [t, flights, memberDocs] = await Promise.all([ref.get(), ref.collection("flights").get(), ref.collection("members").get()]);
  if (!t.exists) return null;
  const known = new Map(memberDocs.docs.map((d) => [d.id, { name: str(d.get("name")), email: str(d.get("email")) }]));

  // Requester: stored on new trips; looked up from the request for older ones.
  let requesterUid = str(t.get("requesterUid"));
  let requester: Person | null = null;
  const reqId = str(t.get("requestId"));
  if (reqId) {
    const r = await db.collection("tripRequests").doc(reqId).get();
    if (r.exists) {
      requesterUid ||= str(r.get("requesterUid"));
      requester = { uid: requesterUid, name: str(r.get("requesterName")), email: str(r.get("requesterEmail")) };
    }
  }
  if (!requester && requesterUid) requester = { uid: requesterUid, ...(known.get(requesterUid) ?? { name: "", email: "" }) };

  const roles = (t.get("roles") ?? {}) as AccessInput["roles"];
  const passengers: AccessInput["passengers"] = [];
  for (const f of flights.docs) {
    const label = flightLabel(f.data());
    for (const p of (f.get("passengers") ?? []) as Record<string, unknown>[]) {
      if (p && typeof p === "object" && typeof p.uid === "string" && p.uid) passengers.push({ flight: label, name: str(p.name), uid: p.uid, email: str(p.email) });
    }
  }

  // Additional access. Migration: older trips have no extraAccessUids, so everyone already on the
  // trip who isn't explained by the requester, a role or a flight is kept as additional access.
  const explained = new Set<string>([requesterUid, ...Object.values(roles).map((r) => r?.uid ?? ""), ...passengers.map((p) => p.uid ?? "")]);
  const roleEmails = new Set(Object.values(roles).map((r) => (r?.email ?? "").toLowerCase()).filter(Boolean));
  const extraUidList: string[] = Array.isArray(t.get("extraAccessUids"))
    ? t.get("extraAccessUids") : ((t.get("memberUids") ?? []) as string[]).filter((u) => !explained.has(u));
  const extraEmails: string[] = Array.isArray(t.get("extraAccessEmails"))
    ? t.get("extraAccessEmails") : ((t.get("pendingEmails") ?? []) as string[]).filter((e) => !roleEmails.has(e.toLowerCase()));

  // Names for additional-access people: their member doc, else the directory.
  const extraUids: Person[] = [];
  for (const uid of extraUidList) {
    let p = known.get(uid);
    if (!p?.name) {
      const d = await db.collection("directory").doc(uid).get();
      if (d.exists) p = { name: str(d.get("name")), email: str(d.get("email")) };
    }
    extraUids.push({ uid, name: p?.name ?? "", email: p?.email ?? "" });
  }

  const result = computeAccess({ requester, roles, passengers, extraUids, extraEmails });
  const batch = db.batch();
  batch.update(ref, {
    memberUids: result.memberUids, pendingEmails: result.pendingEmails,
    extraAccessUids: extraUidList, extraAccessEmails: extraEmails, ...(requesterUid ? { requesterUid } : {}),
  });
  for (const [uid, m] of Object.entries(result.members)) {
    batch.set(ref.collection("members").doc(uid), {
      name: m.name, email: m.email, reasons: m.reasons,
      ...(known.has(uid) ? {} : { addedAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
  }
  for (const d of memberDocs.docs) if (!result.members[d.id]) batch.delete(d.ref);
  await batch.commit();

  const before = new Set<string>((t.get("memberUids") ?? []) as string[]);
  const added = result.memberUids.filter((u) => !before.has(u));
  const tell = recipients(added.filter((u) => !(opts.skipNotify ?? []).includes(u)), opts.actor);
  if (tell.length) {
    const name = str(t.get("name")) || str(t.get("teamName")) || "a trip";
    await notify(db, tell, {
      type: "trip_added", title: "Added to a trip", body: `You've been added to ${name} (${str(t.get("location"))}).`,
      tripId, link: `/trips/${tripId}`,
    });
  }
  return { ...result, added };
}
