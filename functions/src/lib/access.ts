import { getAuth } from "firebase-admin/auth";

export const MAX_MEMBERS = 200;
export const MAX_PENDING = 200;

/** The uid for an email, only if that account has CONFIRMED the address (so access can't be claimed by typing someone's email at sign-up). */
export async function verifiedUidFor(email: string): Promise<{ uid: string; name: string } | null> {
  try {
    const u = await getAuth().getUserByEmail(email);
    return u.emailVerified && !u.disabled ? { uid: u.uid, name: u.displayName ?? "" } : null;
  } catch (e) {
    if ((e as { code?: string }).code === "auth/user-not-found") return null;
    throw e;
  }
}
