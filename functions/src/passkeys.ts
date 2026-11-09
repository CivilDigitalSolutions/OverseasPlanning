import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, type Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { assertVerified } from "./lib/auth";
import { callerIp, rateLimit } from "./lib/rateLimit";
import { RP_NAME } from "./lib/config";
import {
  MAX_PASSKEYS, assertCredentialId, cleanLabel, origins, passkeysOf, rpId, saveChallenge, serverNow, takeChallenge,
} from "./lib/passkeys";

const FAILED = "That passkey did not work. Sign in with your password instead.";

/** Add a passkey: signed in with a confirmed email. User verification (biometric / screen lock) is REQUIRED. */
export const passkeyRegistrationOptions = onCall(async (req) => {
  const { uid } = assertVerified(req);
  await rateLimit("passkeyManage", uid, 30, 3600_000);
  const db = getFirestore();
  const existing = await passkeysOf(db, uid);
  if (existing.length >= MAX_PASSKEYS) throw new HttpsError("resource-exhausted", `You already have ${MAX_PASSKEYS} passkeys.`);
  const user = await getAuth().getUser(uid);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: rpId(), userID: new TextEncoder().encode(uid), userName: user.email ?? uid,
    userDisplayName: user.displayName ?? user.email ?? RP_NAME, attestationType: "none",
    excludeCredentials: existing.map((d) => ({ id: d.id, transports: d.get("transports") ?? undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { challengeId: await saveChallenge(db, options.challenge, uid), options };
});

export const passkeyRegister = onCall(async (req) => {
  const { uid } = assertVerified(req);
  await rateLimit("passkeyManage", uid, 30, 3600_000);
  const db = getFirestore();
  const expectedChallenge = await takeChallenge(db, req.data?.challengeId, uid);
  let v;
  try {
    v = await verifyRegistrationResponse({ response: req.data?.response, expectedChallenge, expectedOrigin: origins(), expectedRPID: rpId(), requireUserVerification: true });
  } catch { throw new HttpsError("invalid-argument", "That passkey could not be checked."); }
  if (!v.verified || !v.registrationInfo) throw new HttpsError("invalid-argument", "That passkey could not be checked.");
  const { credential } = v.registrationInfo;
  const ref = db.collection("passkeys").doc(credential.id);
  const label = cleanLabel(req.data?.label);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.get("uid") !== uid) throw new HttpsError("already-exists", "That passkey belongs to another account.");
    tx.set(ref, {
      uid, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter,
      transports: credential.transports ?? [], label, createdAt: serverNow(), lastUsedAt: null,
    });
  });
  return { id: credential.id, label };
});

/** Sign in with a passkey (unauthenticated). Same message for every failure; limited per IP. */
export const passkeySignInOptions = onCall(async (req) => {
  await rateLimit("passkeySignIn", callerIp(req), 30, 600_000);
  const options = await generateAuthenticationOptions({ rpID: rpId(), userVerification: "required", allowCredentials: [] });
  return { challengeId: await saveChallenge(getFirestore(), options.challenge, null), options };
});

export const passkeySignIn = onCall(async (req) => {
  await rateLimit("passkeySignIn", callerIp(req), 30, 600_000);
  const db = getFirestore();
  const expectedChallenge = await takeChallenge(db, req.data?.challengeId, null);
  const response = req.data?.response;
  const id = assertCredentialId(response?.id);
  const ref = db.collection("passkeys").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("permission-denied", FAILED);
  const uid = snap.get("uid") as string;
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origins(), expectedRPID: rpId(), requireUserVerification: true,
      credential: { id, publicKey: new Uint8Array(Buffer.from(snap.get("publicKey") as string, "base64url")), counter: (snap.get("counter") as number) ?? 0, transports: snap.get("transports") ?? undefined },
    });
  } catch { throw new HttpsError("permission-denied", FAILED); }
  if (!v.verified) throw new HttpsError("permission-denied", FAILED);
  const handle = response?.response?.userHandle;
  if (typeof handle === "string" && handle && Buffer.from(handle, "base64url").toString("utf8") !== uid) throw new HttpsError("permission-denied", FAILED);
  const user = await getAuth().getUser(uid).catch(() => null);
  if (!user || user.disabled) throw new HttpsError("permission-denied", FAILED);
  await ref.update({ counter: v.authenticationInfo.newCounter, lastUsedAt: serverNow() });
  return { customToken: await getAuth().createCustomToken(uid) };
});

const msOf = (t: unknown) => (t as Timestamp | null)?.toMillis?.() ?? 0;

export const listPasskeys = onCall(async (req) => {
  const { uid } = assertVerified(req);
  const docs = await passkeysOf(getFirestore(), uid);
  return { passkeys: docs.map((d) => ({ id: d.id, label: d.get("label") ?? "Passkey", createdAtMs: msOf(d.get("createdAt")), lastUsedAtMs: msOf(d.get("lastUsedAt")) })) };
});

export const deletePasskey = onCall(async (req) => {
  const { uid } = assertVerified(req);
  const id = assertCredentialId(req.data?.id);
  const ref = getFirestore().collection("passkeys").doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.get("uid") !== uid) throw new HttpsError("not-found", "Passkey not found.");
  await ref.delete();
  return { ok: true };
});
