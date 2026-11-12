/**
 * The Live trips window (owner, 2026-11-10) — mirror of web/src/model.ts liveTrips and of the
 * rules' isLiveTrip(): not archived, and either marked Live or starting within 10 days (which
 * includes trips already under way or over but not archived).
 */
export const LIVE_WINDOW_DAYS = 10;

export function isLiveTrip(t: { status?: unknown; startDate?: unknown }, now = Date.now()): boolean {
  if (t.status === "archived") return false;
  if (t.status === "live") return true;
  if (typeof t.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.startDate)) return false;
  return Date.parse(`${t.startDate}T00:00:00Z`) <= now + LIVE_WINDOW_DAYS * 86400000;
}
