import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "./firebase";
import { call } from "./store";

/**
 * Passkeys: fingerprint, face recognition (Face ID / Android face unlock), Windows Hello or a
 * security key. Ported from TrackLink (spec §24 there). Firebase Auth has no passkey support, so
 * the WebAuthn ceremonies are verified server-side (functions/src/passkeys.ts) and a successful
 * sign-in returns a Firebase custom token for the same uid.
 *
 * Works only on the real hosted origin configured as PASSKEY_RP_ID (not on localhost unless the
 * RP ID is set to "localhost" for testing).
 */

export const passkeysSupported = (): boolean => { try { return browserSupportsWebAuthn(); } catch { return false; } };
export const biometricAvailable = (): Promise<boolean> => platformAuthenticatorIsAvailable().catch(() => false);

const cancelled = (e: unknown) => e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");

type AuthOpts = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type RegOpts = Parameters<typeof startRegistration>[0]["optionsJSON"];

/** Resolves false when the person cancelled the device prompt. */
export async function signInWithPasskey(): Promise<boolean> {
  const { challengeId, options } = await call<{ challengeId: string; options: AuthOpts }>("passkeySignInOptions");
  let response;
  try { response = await startAuthentication({ optionsJSON: options }); } catch (e) {
    if (cancelled(e)) return false;
    throw new Error("This device couldn't use a passkey.");
  }
  const { customToken } = await call<{ customToken: string }>("passkeySignIn", { challengeId, response });
  await signInWithCustomToken(auth, customToken);
  return true;
}

export async function addPasskey(label: string): Promise<boolean> {
  const { challengeId, options } = await call<{ challengeId: string; options: RegOpts }>("passkeyRegistrationOptions");
  let response;
  try { response = await startRegistration({ optionsJSON: options }); } catch (e) {
    if (cancelled(e)) return false;
    if (e instanceof Error && e.name === "InvalidStateError") throw new Error("This device already has a passkey.");
    throw new Error("This device couldn't create a passkey.");
  }
  await call("passkeyRegister", { challengeId, response, label });
  return true;
}

export interface PasskeyInfo { id: string; label: string; createdAtMs: number; lastUsedAtMs: number }
export const listPasskeys = () => call<{ passkeys: PasskeyInfo[] }>("listPasskeys").then((r) => r.passkeys);
export const deletePasskey = (id: string) => call("deletePasskey", { id });

/** A label for the passkey from the browser's own description of the device. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
