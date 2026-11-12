import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";

/** Signed in at all (used only where an unverified user must be served, e.g. the agreement record). */
export function assertSignedIn(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  return req.auth.uid;
}

/** Signed in with a CONFIRMED email — required for everything that touches trip data. */
export function assertVerified(req: CallableRequest): { uid: string; email: string } {
  const uid = assertSignedIn(req);
  const t = req.auth!.token;
  if (t.email_verified !== true || typeof t.email !== "string") throw new HttpsError("permission-denied", "Confirm your email first.");
  return { uid, email: t.email.toLowerCase() };
}

export const isHost = (req: CallableRequest) => req.auth?.token.host === true;
export const isAdmin = (req: CallableRequest) => req.auth?.token.admin === true;

export function assertHost(req: CallableRequest) {
  const v = assertVerified(req);
  if (!isHost(req)) throw new HttpsError("permission-denied", "Only the HOST team can do that.");
  return v;
}

export function assertAdmin(req: CallableRequest) {
  const v = assertVerified(req);
  if (!isAdmin(req)) throw new HttpsError("permission-denied", "Admins only.");
  return v;
}

/** The trip, if the caller is HOST or has been given access to it. */
export async function assertTripAccess(req: CallableRequest, tripId: string): Promise<DocumentSnapshot> {
  const { uid } = assertVerified(req);
  const snap = await getFirestore().collection("trips").doc(tripId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Trip not found.");
  const members = (snap.get("memberUids") as string[] | undefined) ?? [];
  if (!isHost(req) && !members.includes(uid)) throw new HttpsError("permission-denied", "You don't have access to this trip.");
  return snap;
}
