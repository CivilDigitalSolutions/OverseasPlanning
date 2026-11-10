/** DEMO stand-ins for the two firebase imports used outside the store (App, Account). */
import { setSignedIn } from "./store";
export const auth = {};
export async function signOut(_auth?: unknown) { setSignedIn(false); }
export async function sendPasswordResetEmail(..._args: unknown[]) { /* simulated */ }
