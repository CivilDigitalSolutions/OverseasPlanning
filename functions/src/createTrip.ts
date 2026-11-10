import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertHost, assertTripAccess, assertVerified } from "./lib/auth";
import { verifiedUidFor, writeMember } from "./lib/access";
import { cleanRisk, cleanRoles, cleanText, isDocId, type RoleKey } from "./lib/validate";

/**
 * HOST turns a submitted request into a trip (spec §3): risk levels + rationale and the four basic
 * roles. The requester and every role holder with a confirmed account get access; role emails
 * without an account are held in pendingEmails until that person signs up (syncPendingAccess).
 */
export const createTrip = onCall(async (req) => {
  const { uid } = assertHost(req);
  const hostName = cleanText(req.auth?.token.name, 80) || cleanText(req.auth?.token.email, 80);
  const requestId = req.data?.requestId;
  if (!isDocId(requestId)) throw new HttpsError("invalid-argument", "Unknown request.");
  let cyber, country;
  try { cyber = cleanRisk(req.data?.cyberRisk, req.data?.cyberRationale, "cyber"); country = cleanRisk(req.data?.countryRisk, req.data?.countryRationale, "country"); }
  catch (e) { throw new HttpsError("invalid-argument", (e as Error).message); }
  const { roles, error } = cleanRoles(req.data?.roles);
  if (error) throw new HttpsError("invalid-argument", error);

  // Resolve emails BEFORE the transaction (Auth lookups can't run inside it).
  const resolved: Partial<Record<RoleKey, { name: string; email: string; uid: string | null }>> = {};
  for (const [k, r] of Object.entries(roles)) {
    const u = r!.email ? await verifiedUidFor(r!.email) : null;
    resolved[k as RoleKey] = { name: r!.name, email: r!.email, uid: u?.uid ?? null };
  }

  const db = getFirestore();
  const reqRef = db.collection("tripRequests").doc(requestId);
  const tripRef = db.collection("trips").doc();
  await db.runTransaction(async (tx) => {
    const r = await tx.get(reqRef);
    if (!r.exists) throw new HttpsError("not-found", "Request not found.");
    if (r.get("status") !== "submitted") throw new HttpsError("failed-precondition", "This request has already been handled.");
    const requesterUid = r.get("requesterUid") as string;
    const members = new Map<string, { name: string; email: string }>();
    members.set(requesterUid, { name: r.get("requesterName") ?? "", email: r.get("requesterEmail") ?? "" });
    const pending = new Set<string>();
    for (const h of Object.values(resolved)) {
      if (!h) continue;
      if (h.uid) members.set(h.uid, { name: h.name, email: h.email });
      else if (h.email) pending.add(h.email);
    }
    const teamName = r.get("teamName") as string;
    const location = r.get("location") as string;
    tx.set(tripRef, {
      name: cleanText(req.data?.name, 120) || `${teamName} – ${location}`,
      teamName, location, startDate: r.get("startDate"), endDate: r.get("endDate"), status: "planning",
      cyberRisk: cyber.level, cyberRationale: cyber.rationale, countryRisk: country.level, countryRationale: country.rationale,
      roles: resolved, memberUids: [...members.keys()], pendingEmails: [...pending], requestId,
      // Shown on the trip's Overview: the HOST member who created the record.
      createdBy: uid, createdByName: hostName, createdByEmail: cleanText(req.auth?.token.email, 254),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    for (const [mUid, m] of members) writeMember(tx, tripRef, mUid, m.name, m.email, { uid, name: hostName });
    tx.update(reqRef, { status: "accepted", tripId: tripRef.id, decidedBy: uid, decidedAt: FieldValue.serverTimestamp() });
  });
  return { tripId: tripRef.id };
});

/**
 * Anyone on the trip changes the role holders (owner decision 2026-11-10). New holders gain access;
 * nobody loses access here (HOST uses removeTripAccess).
 */
export const updateTripRoles = onCall(async (req) => {
  const { uid } = assertVerified(req);
  const hostName = cleanText(req.auth?.token.name, 80) || cleanText(req.auth?.token.email, 80);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  await assertTripAccess(req, tripId);
  const { roles, error } = cleanRoles(req.data?.roles);
  if (error) throw new HttpsError("invalid-argument", error);
  const resolved: Partial<Record<RoleKey, { name: string; email: string; uid: string | null }>> = {};
  for (const [k, r] of Object.entries(roles)) {
    const u = r!.email ? await verifiedUidFor(r!.email) : null;
    resolved[k as RoleKey] = { name: r!.name, email: r!.email, uid: u?.uid ?? null };
  }
  const db = getFirestore();
  const tripRef = db.collection("trips").doc(tripId);
  await db.runTransaction(async (tx) => {
    const t = await tx.get(tripRef);
    if (!t.exists) throw new HttpsError("not-found", "Trip not found.");
    const memberUids = new Set<string>(t.get("memberUids") ?? []);
    const pending = new Set<string>(t.get("pendingEmails") ?? []);
    for (const h of Object.values(resolved)) {
      if (!h) continue;
      if (h.uid && !memberUids.has(h.uid)) { memberUids.add(h.uid); writeMember(tx, tripRef, h.uid, h.name, h.email, { uid, name: hostName }); }
      else if (!h.uid && h.email) pending.add(h.email);
    }
    tx.update(tripRef, {
      roles: resolved, memberUids: [...memberUids], pendingEmails: [...pending],
      updatedAt: FieldValue.serverTimestamp(), updatedBy: uid, updatedByName: hostName,
    });
  });
  return { ok: true };
});
