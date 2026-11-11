/** Stand-ins for the two Firebase imports used outside the store (App's sign-out, Account's reset). */
import { api } from "./client";
import { signOutApi } from "./store";

export const auth = {};
export async function signOut(_auth?: unknown) { await signOutApi(); }
export async function sendPasswordResetEmail(_auth: unknown, email: string, _settings?: unknown) {
  await api("POST", "auth/forgot-password", { email });
}
