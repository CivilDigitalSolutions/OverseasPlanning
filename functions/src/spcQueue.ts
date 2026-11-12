import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertTripAccess, assertVerified } from "./lib/auth";
import { flightLabel } from "./lib/membership";
import { notify, recipients } from "./lib/notify";
import { rateLimit } from "./lib/rateLimit";
import { isDocId } from "./lib/validate";

/**
 * SPC outstanding work (owner decision 2026-11-12). Every trip carries `pendingRequests` and
 * `pendingFlights` (kept here; clients cannot write them — they are not in the rules'
 * overviewKeys), so an SPC sees at a glance which trips wait for them. The trip's SPCs (the named
 * SPC and SPC-profile holders on the trip) are notified when something new needs their decision,
 * and anyone on the trip can send them a reminder.
 */

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function recountSpc(db: Firestore, tripId: string) {
  const ref = db.collection("trips").doc(tripId);
  const [reqs, flights] = await Promise.all([
    ref.collection("tlRequests").where("status", "==", "pending").count().get(),
    ref.collection("flights").get(),
  ]);
  const pendingRequests = reqs.data().count;
  const pendingFlights = flights.docs.filter((f) => !f.get("spcDecision")).length;
  const t = await ref.get();
  if (!t.exists) return null;
  if (t.get("pendingRequests") !== pendingRequests || t.get("pendingFlights") !== pendingFlights) {
    await ref.update({ pendingRequests, pendingFlights });
  }
  return { pendingRequests, pendingFlights, name: str(t.get("name")) || str(t.get("teamName")), roles: t.get("roles"), memberUids: (t.get("memberUids") ?? []) as string[] };
}

/** The named SPC plus SPC-profile holders who are on the trip. */
export async function spcsOf(db: Firestore, trip: { roles?: unknown; memberUids: string[] }): Promise<string[]> {
  const named = str((trip.roles as Record<string, { uid?: unknown }> | undefined)?.spc?.uid);
  const profiles = await db.collection("directory").where("spc", "==", true).get();
  const onTrip = profiles.docs.map((d) => d.id).filter((u) => trip.memberUids.includes(u));
  return [...new Set([named, ...onTrip].filter(Boolean))];
}

async function tell(db: Firestore, tripId: string, actor: string | null, body: string, tab: "requests" | "flights") {
  const t = await recountSpc(db, tripId);
  if (!t) return;
  const to = recipients(await spcsOf(db, t), actor);
  await notify(db, to, { type: "spc_pending", title: "Awaiting your approval", body: `${body} — ${t.name}`, tripId, link: `/trips/${tripId}/${tab}` });
}

/** A request becomes pending (new or resubmitted) → tell the SPCs; any change → recount. */
export const onSpcRequestWritten = onDocumentWritten("trips/{tripId}/tlRequests/{id}", async (event) => {
  const db = getFirestore();
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (after?.status === "pending" && before?.status !== "pending") {
    await tell(db, event.params.tripId, str(after.createdBy) || null, `${before ? "Request resubmitted" : "Request to approve"}: ${str(after.title)}`, "requests");
  } else {
    await recountSpc(db, event.params.tripId);
  }
});

/** A flight needs a decision (new, or an edit cleared one) → tell the SPCs; any change → recount. */
export const onSpcFlightWritten = onDocumentWritten("trips/{tripId}/flights/{id}", async (event) => {
  const db = getFirestore();
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (after && !after.spcDecision && (!before || before.spcDecision)) {
    const actor = str(after.updatedBy) || str(after.createdBy) || null;
    await tell(db, event.params.tripId, actor, `${before ? "Changed flight to approve again" : "Flight to approve"}: ${flightLabel(after)}`, "flights");
  } else {
    await recountSpc(db, event.params.tripId);
  }
});

/** Anyone on the trip reminds its SPCs of what is waiting (3 per hour per person per trip). */
export const remindSpc = onCall(async (req) => {
  const { uid } = assertVerified(req);
  const tripId = req.data?.tripId;
  if (!isDocId(tripId)) throw new HttpsError("invalid-argument", "Unknown trip.");
  await assertTripAccess(req, tripId);
  await rateLimit("remindSpc", `${uid}:${tripId}`, 3, 3600_000);
  const db = getFirestore();
  const t = await recountSpc(db, tripId);
  if (!t) throw new HttpsError("not-found", "Trip not found.");
  const n = t.pendingRequests + t.pendingFlights;
  if (n === 0) return { notified: 0 };
  const to = recipients(await spcsOf(db, t), uid);
  const parts = [t.pendingRequests && `${t.pendingRequests} request${t.pendingRequests === 1 ? "" : "s"}`, t.pendingFlights && `${t.pendingFlights} flight${t.pendingFlights === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
  await notify(db, to, { type: "spc_pending", title: "Reminder: awaiting your approval", body: `${parts} — ${t.name}`, tripId, link: `/trips/${tripId}/requests` });
  return { notified: to.length };
});
