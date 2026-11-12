import { createHash } from "node:crypto";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

/**
 * Fixed-window counters at rateLimits/{sha256(scope:subject)} (functions-only in the rules, TTL on
 * expireAt). FAIL-OPEN: a limiter fault must not stop people signing in.
 */
export async function rateLimit(scope: string, subject: string, max: number, windowMs: number) {
  const id = createHash("sha256").update(`${scope}:${subject}`).digest("hex");
  const ref = getFirestore().collection("rateLimits").doc(id);
  let over = false;
  try {
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const start = (snap.get("windowStart") as Timestamp | undefined)?.toMillis() ?? 0;
      if (!snap.exists || now - start >= windowMs) {
        tx.set(ref, { windowStart: Timestamp.fromMillis(now), count: 1, expireAt: Timestamp.fromMillis(now + windowMs * 2) });
        return;
      }
      if ((snap.get("count") as number) >= max) { over = true; return; }
      tx.update(ref, { count: FieldValue.increment(1) });
    });
  } catch (e) {
    logger.warn("rate limiter failed open", { scope, e: String(e) });
    return;
  }
  if (over) throw new HttpsError("resource-exhausted", "Too many attempts. Try again later.");
}

export const callerIp = (req: CallableRequest) =>
  String(req.rawRequest?.headers?.["x-forwarded-for"] ?? req.rawRequest?.ip ?? "unknown").split(",")[0].trim();
