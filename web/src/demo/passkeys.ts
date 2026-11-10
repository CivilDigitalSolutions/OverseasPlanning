/** DEMO passkeys: kept on the demo account; the device prompt is simulated (see Auth.tsx). */
import { be } from "./backend";
import { accountPath, toAccount } from "./store";

export const passkeysSupported = () => true;
export const biometricAvailable = async () => true;
export interface PasskeyInfo { id: string; label: string; createdAtMs: number; lastUsedAtMs: number }

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  return toAccount(await be().get(accountPath()))?.passkeys ?? [];
}
export async function addPasskey(label: string): Promise<boolean> {
  const list = await listPasskeys();
  if (list.some((p) => p.label === label)) throw new Error("This device already has a passkey.");
  await be().patch(accountPath(), { passkeys: [...list, { id: be().newId(), label, createdAtMs: Date.now(), lastUsedAtMs: 0 }] });
  return true;
}
export async function deletePasskey(id: string) {
  await be().patch(accountPath(), { passkeys: (await listPasskeys()).filter((p) => p.id !== id) });
}
export const signInWithPasskey = async () => false;
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
