import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "./client";
import { reloadSession } from "./store";

/**
 * Passkeys against the Laravel API (api/app/Http/Controllers/PasskeyController.php). Same exports
 * as ../passkeys.ts. Sign-in carries the terms agreement, which the server records.
 */
export const passkeysSupported = (): boolean => { try { return browserSupportsWebAuthn(); } catch { return false; } };
export const biometricAvailable = (): Promise<boolean> => platformAuthenticatorIsAvailable().catch(() => false);

const cancelled = (e: unknown) => e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");
type AuthOpts = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type RegOpts = Parameters<typeof startRegistration>[0]["optionsJSON"];

export async function signInWithPasskey(): Promise<boolean> {
  const { challengeId, options } = await api<{ challengeId: string; options: AuthOpts }>("POST", "auth/passkey/options");
  let response;
  try { response = await startAuthentication({ optionsJSON: options }); } catch (e) {
    if (cancelled(e)) return false;
    throw new Error("This device couldn't use a passkey.");
  }
  await api("POST", "auth/passkey", { challengeId, response, agree: true });
  await reloadSession();
  return true;
}

export async function addPasskey(label: string): Promise<boolean> {
  const { challengeId, options } = await api<{ challengeId: string; options: RegOpts }>("POST", "passkeys/options");
  let response;
  try { response = await startRegistration({ optionsJSON: options }); } catch (e) {
    if (cancelled(e)) return false;
    if (e instanceof Error && e.name === "InvalidStateError") throw new Error("This device already has a passkey.");
    throw new Error("This device couldn't create a passkey.");
  }
  await api("POST", "passkeys", { challengeId, response, label });
  return true;
}

export interface PasskeyInfo { id: string; label: string; createdAtMs: number; lastUsedAtMs: number }
export const listPasskeys = () => api<{ passkeys: PasskeyInfo[] }>("GET", "passkeys").then((r) => r.passkeys);
export const deletePasskey = (id: string) => api("DELETE", `passkeys/${encodeURIComponent(id)}`);

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
