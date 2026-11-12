import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertTripAccess, assertVerified } from "./lib/auth";
import { MAX_MEMBERS, MAX_PENDING, verifiedUidFor } from "./lib/access";
import { flightLabel, recomputeTripAccess } from "./lib/membership";
import { notify, recipients } from "./lib/notify";
import { rateLimit } from "./lib/rateLimit";
import { cleanEmail, isDocId } from "./lib/validate";

const isUid = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);

/**
 * Additional access (spec §6): anyone who can already see a trip adds someone — picked from the
 * in-app directory (uid) or typed as an email. A confirmed account gets access at once; an email
 * with no account waits until that person signs up.
 */
export const addTripAccess = onCall(async (req) => {
  const { uid } = assertVerified(req);
  await rateLimit("addTripAccess", uid, 60, 3600_000);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  const trip = await assertTripAccess(req, tripId);
  const db = getFirestore();

  let targetUid: string | null = null;
  let email: string | null = null;
  if (isUid(req.data?.uid)) {
    const dir = await db.collection("directory").doc(req.data.uid).get();
    if (!dir.exists) throw new HttpsError("not-found", "That person isn't in the directory.");
    targetUid = req.data.uid;
  } else {
    email = cleanEmail(req.data?.email);
    if (!email) throw new HttpsError("invalid-argument", "Choose a person or enter a valid email.");
    targetUid = (await verifiedUidFor(email))?.uid ?? null;
  }
  const members: string[] = trip.get("memberUids") ?? [];
  if (targetUid) {
    if (members.includes(targetUid)) return { status: "already" };
    if (members.length >= MAX_MEMBERS) throw new HttpsError("resource-exhausted", "This trip has the maximum number of people.");
    await trip.ref.update({ extraAccessUids: FieldValue.arrayUnion(targetUid), ...(email ? { extraAccessEmails: FieldValue.arrayRemove(email) } : {}) });
  } else {
    const pending: string[] = trip.get("pendingEmails") ?? [];
    if (pending.includes(email!)) return { status: "already" };
    if (pending.length >= MAX_PENDING) throw new HttpsError("resource-exhausted", "Too many pending invitations.");
    await trip.ref.update({ extraAccessEmails: FieldValue.arrayUnion(email) });
  }
  await recomputeTripAccess(db, tripId, { actor: uid });
  return { status: targetUid ? "added" : "pending" };
});

/**
 * Anyone on the trip (or HOST) removes ADDITIONAL access — a person or a pending email (owner,
 * 2026-11-12; was HOST only). Someone in a role, on a flight or who requested the trip keeps
 * access; the result says so.
 */
export const removeTripAccess = onCall(async (req) => {
  const { uid: actor } = assertVerified(req);
  await rateLimit("removeTripAccess", actor, 60, 3600_000);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  await assertTripAccess(req, tripId);
  const db = getFirestore();
  const ref = db.collection("trips").doc(tripId);
  if (isUid(req.data?.uid)) await ref.update({ extraAccessUids: FieldValue.arrayRemove(req.data.uid) });
  else {
    const email = cleanEmail(req.data?.email);
    if (!email) throw new HttpsError("invalid-argument", "Nothing to remove.");
    await ref.update({ extraAccessEmails: FieldValue.arrayRemove(email) });
  }
  const result = await recomputeTripAccess(db, tripId);
  const still = isUid(req.data?.uid) ? result?.members[req.data.uid]?.reasons ?? [] : [];
  return { ok: true, stillOnTripAs: still };
});

/** After confirming their email, a person receives every trip that was waiting for that address. */
export const syncPendingAccess = onCall(async (req) => {
  const { uid, email } = assertVerified(req);
  const db = getFirestore();
  const trips = await db.collection("trips").where("pendingEmails", "array-contains", email).limit(100).get();
  for (const t of trips.docs) {
    const roles = (t.get("roles") ?? {}) as Record<string, { email?: string; uid?: string | null }>;
    const patch: Record<string, unknown> = {};
    for (const [k, r] of Object.entries(roles)) if ((r?.email ?? "").toLowerCase() === email) patch[`roles.${k}.uid`] = uid;
    if (((t.get("extraAccessEmails") ?? []) as string[]).includes(email)) {
      patch.extraAccessEmails = FieldValue.arrayRemove(email);
      patch.extraAccessUids = FieldValue.arrayUnion(uid);
    }
    if (Object.keys(patch).length) await t.ref.update(patch);
    await recomputeTripAccess(db, t.id);
  }
  return { added: trips.size };
});

/** Booking someone on a flight (or taking them off) changes who is part of the trip. */
export const onFlightWritten = onDocumentWritten("trips/{tripId}/flights/{flightId}", async (event) => {
  const uidsOf = (d: FirebaseFirestore.DocumentData | undefined) =>
    new Set(((d?.passengers ?? []) as { uid?: string }[]).map((p) => p?.uid ?? "").filter(Boolean));
  const before = uidsOf(event.data?.before?.data());
  const afterData = event.data?.after?.data();
  const after = uidsOf(afterData);
  // Only act when the set of booked people changed (cost/status edits don't affect access).
  if (before.size === after.size && [...after].every((u) => before.has(u))) return;
  const db = getFirestore();
  const booked = [...after].filter((u) => !before.has(u));
  const actor = typeof afterData?.updatedBy === "string" ? afterData.updatedBy : (afterData?.createdBy as string | undefined);
  // "Booked on a flight" also covers being added to the trip by it: one notification, not two.
  await recomputeTripAccess(db, event.params.tripId, { actor, skipNotify: booked });
  const tell = recipients(booked, actor);
  if (tell.length && afterData) {
    const trip = await db.collection("trips").doc(event.params.tripId).get();
    const route = [afterData.from, afterData.to].filter(Boolean).join(" → ");
    await notify(db, tell, {
      type: "flight_added", title: "Booked on a flight",
      body: `${flightLabel(afterData)}${route ? ` ${route}` : ""}${afterData.departAt ? `, ${String(afterData.departAt).replace("T", " ")}` : ""} — ${trip.get("name") ?? "your trip"}.`,
      tripId: event.params.tripId, link: `/trips/${event.params.tripId}/flights`,
    });
  }
});

/** New message on a trip: everyone on the trip except the sender. */
export const onMessageCreated = onDocumentCreated("trips/{tripId}/messages/{messageId}", async (event) => {
  const m = event.data?.data();
  if (!m) return;
  const db = getFirestore();
  const trip = await db.collection("trips").doc(event.params.tripId).get();
  if (!trip.exists) return;
  const tell = recipients((trip.get("memberUids") ?? []) as string[], m.senderUid as string);
  const text = String(m.text ?? "");
  await notify(db, tell, {
    type: "message", title: `${m.senderName || "New message"} · ${trip.get("name") || "Trip"}`,
    body: text.length > 140 ? `${text.slice(0, 137)}…` : text, tripId: event.params.tripId, link: `/trips/${event.params.tripId}/messages`,
  });
});
