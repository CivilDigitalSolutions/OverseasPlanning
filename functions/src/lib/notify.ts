/**
 * Notifications (owner decision 2026-11-10): people are told when they are ADDED TO A TRIP, BOOKED
 * ON A FLIGHT, or a NEW MESSAGE arrives on a trip they are on.
 *
 * Two layers, so there is always something even where push isn't possible:
 *  1. an in-app inbox, users/{uid}/notifications/{id} (bell + banner in the app; 60-day TTL);
 *  2. web push through Firebase Cloud Messaging to every device the person switched on
 *     (users/{uid}/pushTokens/{id}). On iPhone web push works only for the installed (Home Screen)
 *     app — an Apple limit. Tokens FCM reports as dead are deleted.
 */
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions/v2";

export type NotificationType = "trip_added" | "flight_added" | "message" | "spc_pending";
export interface Note { type: NotificationType; title: string; body: string; tripId: string; link: string }

const INBOX_DAYS = 60;
const DEAD_TOKEN = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);

/** Who to tell: the given people, minus whoever caused it, without duplicates. */
export function recipients(uids: Iterable<string>, actor?: string | null): string[] {
  return [...new Set([...uids].filter((u) => u && u !== actor))];
}

export async function notify(db: Firestore, uids: string[], note: Note): Promise<void> {
  if (uids.length === 0) return;
  const expireAt = Timestamp.fromMillis(Date.now() + INBOX_DAYS * 86400000);
  const batch = db.batch();
  for (const uid of uids) {
    batch.set(db.collection("users").doc(uid).collection("notifications").doc(), {
      ...note, read: false, createdAt: FieldValue.serverTimestamp(), expireAt,
    });
  }
  await batch.commit();

  // Push: one multicast per person so dead tokens can be pruned from the right place.
  await Promise.all(uids.map(async (uid) => {
    const tokens = await db.collection("users").doc(uid).collection("pushTokens").get();
    if (tokens.empty) return;
    try {
      const res = await getMessaging().sendEachForMulticast({
        tokens: tokens.docs.map((d) => d.get("token") as string),
        notification: { title: note.title, body: note.body },
        data: { type: note.type, tripId: note.tripId, link: note.link },
        webpush: { fcmOptions: { link: note.link }, notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: `${note.type}:${note.tripId}` } },
      });
      await Promise.all(res.responses.map((r, i) => (!r.success && r.error && DEAD_TOKEN.has(r.error.code) ? tokens.docs[i].ref.delete() : null)));
    } catch (e) {
      logger.warn("push failed", { uid, e: String(e) });
    }
  }));
}
