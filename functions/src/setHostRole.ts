import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertAdmin } from "./lib/auth";
import { cleanEmail } from "./lib/validate";

/**
 * Admin grants or removes the HOST (triage team) role — a custom claim, so the rules and every
 * callable can trust it. The first admin is created with functions/scripts/grant-admin.js.
 */
export const setHostRole = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const host = req.data?.host === true;
  const user = await getAuth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError("not-found", "No account with that email.");
  await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), host });
  await getFirestore().collection("roleChanges").add({ uid: user.uid, email, host, by: adminUid, at: FieldValue.serverTimestamp() });
  return { uid: user.uid };
});
