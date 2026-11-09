import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertSignedIn } from "./lib/auth";
import { AGREEMENT_METHODS, cleanText } from "./lib/validate";
import { callerIp } from "./lib/rateLimit";

/**
 * Records that the signed-in person agreed to the Terms and Privacy Policy for THIS sign-in.
 * Server-stamped (time, IP, user agent, document versions) and append-only: users/{uid}/agreements
 * is functions-write-only in the rules, so the record can't be edited or forged by a client.
 * Deliberately allowed before email confirmation, since agreement happens at sign-in.
 */
export const recordAgreement = onCall(async (req) => {
  const uid = assertSignedIn(req);
  const method = req.data?.method;
  if (!AGREEMENT_METHODS.includes(method)) throw new HttpsError("invalid-argument", "Unknown sign-in method.");
  const termsVersion = cleanText(req.data?.termsVersion, 40);
  const privacyVersion = cleanText(req.data?.privacyVersion, 40);
  if (!termsVersion || !privacyVersion) throw new HttpsError("invalid-argument", "Missing document versions.");
  const db = getFirestore();
  const ref = db.collection("users").doc(uid).collection("agreements").doc();
  const batch = db.batch();
  batch.set(ref, {
    termsVersion, privacyVersion, method,
    email: req.auth?.token.email ?? null,
    ip: callerIp(req),
    userAgent: cleanText(req.data?.userAgent, 400) || cleanText(req.rawRequest?.headers?.["user-agent"], 400),
    acceptedAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.collection("users").doc(uid), { lastAgreementAt: FieldValue.serverTimestamp(), termsVersion, privacyVersion }, { merge: true });
  await batch.commit();
  return { id: ref.id };
});
