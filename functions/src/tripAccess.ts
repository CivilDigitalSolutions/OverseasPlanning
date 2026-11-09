import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertHost, assertTripAccess, assertVerified } from "./lib/auth";
import { MAX_MEMBERS, MAX_PENDING, verifiedUidFor, writeMember } from "./lib/access";
import { rateLimit } from "./lib/rateLimit";
import { cleanEmail, cleanText, isDocId } from "./lib/validate";

/**
 * Additional access (spec §6): anyone who can already see a trip may add someone by email.
 * A confirmed account gets access at once; otherwise the email waits in pendingEmails.
 */
export const addTripAccess = onCall(async (req) => {
  const { uid } = assertVerified(req);
  await rateLimit("addTripAccess", uid, 60, 3600_000);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Enter a valid email.");
  await assertTripAccess(req, tripId);
  const target = await verifiedUidFor(email);
  const addedBy = { uid, name: cleanText(req.auth?.token.name, 80) || cleanText(req.auth?.token.email, 80) };
  const name = cleanText(req.data?.name, 80) || target?.name || email.split("@")[0];
  const db = getFirestore();
  const ref = db.collection("trips").doc(tripId);
  return db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    const members: string[] = t.get("memberUids") ?? [];
    const pending: string[] = t.get("pendingEmails") ?? [];
    if (target) {
      if (members.includes(target.uid)) return { status: "already" };
      if (members.length >= MAX_MEMBERS) throw new HttpsError("resource-exhausted", "This trip has the maximum number of people.");
      tx.update(ref, { memberUids: FieldValue.arrayUnion(target.uid), pendingEmails: FieldValue.arrayRemove(email) });
      writeMember(tx, ref, target.uid, name, email, addedBy);
      return { status: "added" };
    }
    if (pending.includes(email)) return { status: "already" };
    if (pending.length >= MAX_PENDING) throw new HttpsError("resource-exhausted", "Too many pending invitations.");
    tx.update(ref, { pendingEmails: FieldValue.arrayUnion(email) });
    return { status: "pending" };
  });
});

/** HOST removes a person (by uid) or a pending email. */
export const removeTripAccess = onCall(async (req) => {
  assertHost(req);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  const db = getFirestore();
  const ref = db.collection("trips").doc(tripId);
  if (typeof req.data?.uid === "string" && /^[A-Za-z0-9]{1,128}$/.test(req.data.uid)) {
    const target = req.data.uid as string;
    const batch = db.batch();
    batch.update(ref, { memberUids: FieldValue.arrayRemove(target) });
    batch.delete(ref.collection("members").doc(target));
    await batch.commit();
    return { ok: true };
  }
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Nothing to remove.");
  await ref.update({ pendingEmails: FieldValue.arrayRemove(email) });
  return { ok: true };
});

/** After confirming their email, a person receives every trip that was waiting for that address. */
export const syncPendingAccess = onCall(async (req) => {
  const { uid, email } = assertVerified(req);
  const db = getFirestore();
  const trips = await db.collection("trips").where("pendingEmails", "array-contains", email).limit(100).get();
  const name = cleanText(req.auth?.token.name, 80) || email.split("@")[0];
  for (const t of trips.docs) {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(t.ref);
      if (!((fresh.get("pendingEmails") ?? []) as string[]).includes(email)) return;
      // Fill in the uid on any role held by this email, so the Team Leader is recognised.
      const roles = (fresh.get("roles") ?? {}) as Record<string, { email?: string; uid?: string | null }>;
      const patch: Record<string, unknown> = { memberUids: FieldValue.arrayUnion(uid), pendingEmails: FieldValue.arrayRemove(email) };
      for (const [k, r] of Object.entries(roles)) if (r?.email === email) patch[`roles.${k}.uid`] = uid;
      tx.update(t.ref, patch);
      tx.set(t.ref.collection("members").doc(uid), { name, email, addedByName: "Invitation", addedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
  return { added: trips.size };
});
