import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertAdmin } from "./lib/auth";
import { cleanEmail } from "./lib/validate";

/**
 * Admin grants or removes a role profile — a custom claim, so the rules and every callable can
 * trust it:
 *   host        the HOST (triage) team: sees every trip and every request.
 *   controller  sees every LIVE trip's basic details and team messages, and can post there
 *               (owner decision 2026-11-10).
 * The first admin is created with functions/scripts/grant-admin.js. The person must sign out and
 * in (or the app refreshes the token) before the change takes effect.
 */
const ROLES = ["host", "controller", "admin"] as const;

export const setRole = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const role = req.data?.role;
  if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "Unknown role.");
  const on = req.data?.on === true;
  if (role === "admin" && !on && req.auth?.token.email?.toLowerCase() === email) throw new HttpsError("failed-precondition", "You can't remove your own Administrator permission.");
  const user = await getAuth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError("not-found", "No account with that email.");
  await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), [role]: on });
  await getFirestore().collection("roleChanges").add({ uid: user.uid, email, role, on, by: adminUid, at: FieldValue.serverTimestamp() });
  return { uid: user.uid };
});

/** Kept for older clients: setHostRole({email, host}) = setRole({email, role: "host", on: host}). */
export const setHostRole = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const user = await getAuth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError("not-found", "No account with that email.");
  await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), host: req.data?.host === true });
  await getFirestore().collection("roleChanges").add({ uid: user.uid, email, role: "host", on: req.data?.host === true, by: adminUid, at: FieldValue.serverTimestamp() });
  return { uid: user.uid };
});
