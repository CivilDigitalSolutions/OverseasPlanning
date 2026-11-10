import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { assertVerified } from "./lib/auth";
import { isLiveTrip } from "./lib/live";

/**
 * Controllers see every live trip (owner decision 2026-11-10). A Firestore query can't express the
 * live window in a way the rules can prove, so controllers get the list here: the BASIC details
 * only (no planning data). Opening a trip and its messages is then authorised by the rules
 * (isController() && isLiveTrip()).
 */
export const listLiveTrips = onCall(async (req) => {
  assertVerified(req);
  if (req.auth?.token.controller !== true) throw new HttpsError("permission-denied", "Controllers only.");
  const snap = await getFirestore().collection("trips").where("status", "in", ["planning", "live"]).get();
  const trips = snap.docs.filter((d) => isLiveTrip(d.data())).map((d) => {
    const v = d.data();
    const roles: Record<string, { name: string }> = {};
    for (const [k, r] of Object.entries((v.roles ?? {}) as Record<string, { name?: string }>)) if (r?.name) roles[k] = { name: r.name };
    return {
      id: d.id, name: v.name ?? "", teamName: v.teamName ?? "", location: v.location ?? "", startDate: v.startDate ?? "",
      endDate: v.endDate ?? "", status: v.status ?? "planning", cyberRisk: v.cyberRisk ?? "", countryRisk: v.countryRisk ?? "", roles,
    };
  });
  return { trips };
});
