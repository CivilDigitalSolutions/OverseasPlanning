/**
 * Passkeys (ported from TrackLink spec §24): fingerprint / face / Windows Hello / security key.
 * Firebase Auth has no passkey support, so the WebAuthn ceremonies are verified here with
 * @simplewebauthn/server and a successful sign-in returns a Firebase custom token.
 *
 * Root collections, functions-only in the rules:
 *   passkeyChallenges/{id}   one-time challenge, 5-minute life, deleted when used
 *   passkeys/{credentialId}  { uid, publicKey, counter, transports, label, createdAt, lastUsedAt }
 */
import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { PASSKEY_ORIGINS, PASSKEY_RP_ID } from "./config";

export const rpId = () => PASSKEY_RP_ID.value();
export const origins = () => PASSKEY_ORIGINS.value().split(",").map((s) => s.trim()).filter(Boolean);

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_PASSKEYS = 10;

export function cleanLabel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "";
  return s || "Passkey";
}

export function assertCredentialId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{16,512}$/.test(raw)) throw new HttpsError("invalid-argument", "That is not a passkey.");
  return raw;
}

export async function saveChallenge(db: Firestore, challenge: string, uid: string | null): Promise<string> {
  const id = randomBytes(16).toString("hex");
  await db.collection("passkeyChallenges").doc(id).set({ challenge, uid, expireAt: Timestamp.fromMillis(Date.now() + CHALLENGE_TTL_MS) });
  return id;
}

/** Take a challenge ONCE (deleted in the same transaction, so a response cannot be replayed). */
export async function takeChallenge(db: Firestore, rawId: unknown, uid: string | null): Promise<string> {
  if (typeof rawId !== "string" || !/^[a-f0-9]{32}$/.test(rawId)) throw new HttpsError("invalid-argument", "Start again.");
  const ref = db.collection("passkeyChallenges").doc(rawId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("failed-precondition", "That took too long. Start again.");
    tx.delete(ref);
    if ((snap.get("expireAt") as Timestamp).toMillis() < Date.now()) throw new HttpsError("failed-precondition", "That took too long. Start again.");
    if ((snap.get("uid") ?? null) !== uid) throw new HttpsError("permission-denied", "Start again.");
    return snap.get("challenge") as string;
  });
}

export const passkeysOf = async (db: Firestore, uid: string) => (await db.collection("passkeys").where("uid", "==", uid).get()).docs;
export const serverNow = () => FieldValue.serverTimestamp();
