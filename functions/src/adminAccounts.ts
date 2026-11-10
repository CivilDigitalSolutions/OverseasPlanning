/**
 * Account manager (owner decision 2026-11-10): people with the ADMINISTRATOR permission (the
 * `admin` custom claim) add people to the app, delete accounts and change role profiles
 * (HOST, Controller, Administrator). Reached from the settings cog in the app.
 *
 * New accounts are created without a password; the administrator sends the person the
 * set-password link returned here. The address is treated as confirmed because an administrator
 * vouched for it (the person still proves they own the inbox by using the link).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assertAdmin } from "./lib/auth";
import { recomputeTripAccess } from "./lib/membership";
import { cleanEmail, cleanText } from "./lib/validate";

export const ROLE_PROFILES = ["host", "controller", "admin"] as const;
export type RoleProfile = (typeof ROLE_PROFILES)[number];

/** Only known role names, as booleans. */
export function cleanRoleProfiles(raw: unknown): Record<RoleProfile, boolean> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { host: r.host === true, controller: r.controller === true, admin: r.admin === true };
}

const view = (u: UserRecord) => ({
  uid: u.uid, name: u.displayName ?? "", email: u.email ?? "", emailVerified: u.emailVerified, disabled: u.disabled,
  roles: cleanRoleProfiles(u.customClaims), createdAt: u.metadata.creationTime ?? "", lastSignIn: u.metadata.lastSignInTime ?? "",
});

export const listAccounts = onCall(async (req) => {
  assertAdmin(req);
  const out: ReturnType<typeof view>[] = [];
  let token: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, token);
    out.push(...page.users.map(view));
    token = page.pageToken;
  } while (token && out.length < 5000);
  return { accounts: out.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)) };
});

export const createAccount = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const email = cleanEmail(req.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const name = cleanText(req.data?.name, 80);
  if (!name) throw new HttpsError("invalid-argument", "Enter a name.");
  const roles = cleanRoleProfiles(req.data?.roles);
  if (await getAuth().getUserByEmail(email).catch(() => null)) throw new HttpsError("already-exists", "An account already exists for that email.");
  const user = await getAuth().createUser({ email, displayName: name, emailVerified: true });
  await getAuth().setCustomUserClaims(user.uid, roles);
  const db = getFirestore();
  await Promise.all([
    db.collection("directory").doc(user.uid).set({ name, email, updatedAt: FieldValue.serverTimestamp() }),
    db.collection("users").doc(user.uid).set({ name, email, createdAt: FieldValue.serverTimestamp(), createdByAdmin: adminUid }, { merge: true }),
    db.collection("roleChanges").add({ uid: user.uid, email, created: true, roles, by: adminUid, at: FieldValue.serverTimestamp() }),
  ]);
  // TODO(owner): send this by email (branded, like TrackLink's Resend sender) instead of handing it to the admin.
  const setupLink = await getAuth().generatePasswordResetLink(email);
  // Trips waiting for this email (roles / invitations) are picked up when the person first signs in.
  return { uid: user.uid, setupLink };
});

export const setAccountRoles = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const target = typeof req.data?.uid === "string" ? req.data.uid : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target)) throw new HttpsError("invalid-argument", "Unknown account.");
  const roles = cleanRoleProfiles(req.data?.roles);
  if (target === adminUid && !roles.admin) throw new HttpsError("failed-precondition", "You can't remove your own Administrator permission.");
  const user = await getAuth().getUser(target).catch(() => null);
  if (!user) throw new HttpsError("not-found", "Account not found.");
  await getAuth().setCustomUserClaims(target, { ...(user.customClaims ?? {}), ...roles });
  await getFirestore().collection("roleChanges").add({ uid: target, email: user.email ?? "", roles, by: adminUid, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const deleteAccount = onCall(async (req) => {
  const { uid: adminUid } = assertAdmin(req);
  const target = typeof req.data?.uid === "string" ? req.data.uid : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(target)) throw new HttpsError("invalid-argument", "Unknown account.");
  if (target === adminUid) throw new HttpsError("failed-precondition", "You can't delete your own account here.");
  const user = await getAuth().getUser(target).catch(() => null);
  if (!user) throw new HttpsError("not-found", "Account not found.");
  const db = getFirestore();

  // Take the person off every trip: additional access, role links and flight bookings.
  const trips = await db.collection("trips").where("memberUids", "array-contains", target).get();
  for (const t of trips.docs) {
    const roles = (t.get("roles") ?? {}) as Record<string, { uid?: string | null }>;
    const patch: Record<string, unknown> = { extraAccessUids: FieldValue.arrayRemove(target) };
    for (const [k, r] of Object.entries(roles)) if (r?.uid === target) patch[`roles.${k}.uid`] = null;
    if (t.get("requesterUid") === target) patch.requesterUid = FieldValue.delete();
    await t.ref.update(patch);
    const flights = await t.ref.collection("flights").get();
    for (const f of flights.docs) {
      const ps = (f.get("passengers") ?? []) as Record<string, unknown>[];
      if (ps.some((p) => p?.uid === target)) {
        await f.ref.update({ passengers: ps.map((p) => (p?.uid === target ? { name: p.name, travelClass: p.travelClass } : p)) });
      }
    }
    await recomputeTripAccess(db, t.id);
  }
  const passkeys = await db.collection("passkeys").where("uid", "==", target).get();
  const batch = db.batch();
  passkeys.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(db.collection("directory").doc(target));
  batch.set(db.collection("roleChanges").doc(), { uid: target, email: user.email ?? "", deleted: true, by: adminUid, at: FieldValue.serverTimestamp() });
  await batch.commit();
  await getAuth().deleteUser(target);
  // Their own records (agreement history, trip requests) are kept for the audit trail.
  return { ok: true, tripsUpdated: trips.size };
});
