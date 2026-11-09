/**
 * Overseas Planning — domain model. Pure TypeScript with no Firebase imports, so `node --test`
 * can exercise it. The Firestore shapes are documented in docs/SPEC.md §4; firestore.rules
 * validates the same field lists — keep ITEM_SCHEMAS and the rules' allowlists in step.
 */

// ---- Roles ------------------------------------------------------------------------------------

/** The four basic role profiles HOST assigns when creating a trip (spec §3). */
export const TRIP_ROLES = [
  { key: "teamLeader", label: "Team Leader" },
  { key: "officeManager", label: "Office Manager" },
  { key: "spc", label: "SPC" },
  { key: "intelWorker", label: "Intel Worker" },
] as const;
export type TripRoleKey = (typeof TRIP_ROLES)[number]["key"];

export interface RoleHolder {
  name: string;
  email: string;
  /** Set by the server once the email belongs to a signed-up account. */
  uid?: string | null;
}

// ---- Risk -------------------------------------------------------------------------------------

/**
 * Risk levels for the two drop-downs. TODO(owner): confirm the organisation's own scale — these
 * four are placeholders (spec §3, open question). Changing them needs firestore.rules too.
 */
export const RISK_LEVELS = ["Low", "Medium", "High", "Critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const riskTone = (r: string): "ok" | "warn" | "bad" | "crit" | "none" =>
  r === "Low" ? "ok" : r === "Medium" ? "warn" : r === "High" ? "bad" : r === "Critical" ? "crit" : "none";

// ---- Trip -------------------------------------------------------------------------------------

export type TripStatus = "planning" | "live" | "archived";
export const TRIP_STATUSES: { key: TripStatus; label: string }[] = [
  { key: "planning", label: "Planning" },
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
];

export interface Trip {
  id: string;
  name: string;
  teamName: string;
  location: string;
  startDate: string; // yyyy-mm-dd
  endDate: string; // yyyy-mm-dd
  status: TripStatus;
  cyberRisk: string;
  cyberRationale: string;
  countryRisk: string;
  countryRationale: string;
  roles: Partial<Record<TripRoleKey, RoleHolder>>;
  memberUids: string[];
  pendingEmails: string[];
  requestId: string | null;
  createdAtMs: number;
}

export type RequestStatus = "submitted" | "accepted" | "declined";

export interface TripRequest {
  id: string;
  teamName: string;
  startDate: string;
  endDate: string;
  location: string;
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;
  status: RequestStatus;
  tripId: string | null;
  declineReason: string;
  createdAtMs: number;
}

// ---- Validation -------------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export interface RequestInput {
  teamName: string;
  startDate: string;
  endDate: string;
  location: string;
}

/** Returns a message per invalid field (empty object = valid). Mirrors firestore.rules tripRequests. */
export function validateRequest(r: RequestInput): Partial<Record<keyof RequestInput, string>> {
  const e: Partial<Record<keyof RequestInput, string>> = {};
  if (!r.teamName.trim()) e.teamName = "Enter your team name.";
  else if (r.teamName.trim().length > 80) e.teamName = "Keep the team name under 80 characters.";
  if (!r.location.trim()) e.location = "Enter where you are travelling to.";
  else if (r.location.trim().length > 120) e.location = "Keep the location under 120 characters.";
  if (!isIsoDate(r.startDate)) e.startDate = "Choose the date you leave.";
  if (!isIsoDate(r.endDate)) e.endDate = "Choose the date you return.";
  if (!e.startDate && !e.endDate && r.endDate < r.startDate) e.endDate = "The return date is before the departure date.";
  return e;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normaliseEmail = (s: string) => s.trim().toLowerCase();

// ---- Search (archived trips) ----------------------------------------------------------------------

/** Every word must appear somewhere in the trip's searchable text, in any order, case-insensitive. */
export function tripMatches(t: Trip, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [
    t.name, t.teamName, t.location, t.startDate, t.endDate, t.cyberRisk, t.countryRisk,
    ...Object.values(t.roles).flatMap((r) => (r ? [r.name, r.email] : [])),
  ].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Trips for one list, newest departure first for archive, soonest first otherwise. */
export function tripsFor(trips: Trip[], status: TripStatus, q = ""): Trip[] {
  const list = trips.filter((t) => t.status === status && tripMatches(t, q));
  return list.sort((a, b) =>
    status === "archived" ? b.startDate.localeCompare(a.startDate) : a.startDate.localeCompare(b.startDate),
  );
}

/** A hint shown to HOST when the dates say a trip should move on (status is never changed automatically). */
export function statusHint(t: Trip, todayIso: string): string | null {
  if (t.status === "planning" && t.startDate && todayIso >= t.startDate) return "The departure date has arrived — mark this trip Live?";
  if (t.status === "live" && t.endDate && todayIso > t.endDate) return "The return date has passed — archive this trip once the debrief is done?";
  return null;
}

export const todayIso = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function formatDate(iso: string): string {
  if (!isIsoDate(iso)) return iso || "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const dateRange = (a: string, b: string) => `${formatDate(a)} – ${formatDate(b)}`;

// ---- Planning items (flights, hotels, hire cars, assets) ------------------------------------------

export type FieldType = "text" | "textarea" | "date" | "datetime" | "number" | "list" | "checkbox";
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  max?: number;
  hint?: string;
}

export interface ItemSchema {
  collection: string;
  singular: string;
  plural: string;
  /** Fields shown as the row title / subtitle. */
  title: (v: Record<string, unknown>) => string;
  subtitle: (v: Record<string, unknown>) => string;
  fields: FieldSpec[];
}

const s = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const when = (v: unknown) => (s(v) ? s(v).replace("T", " ") : "");

/**
 * Field lists per planning tab. TODO(owner): confirm each list — these are a reasonable first cut,
 * not a requirement (spec §5). firestore.rules `itemKeys()` must list the same keys.
 */
export const ITEM_SCHEMAS = {
  flights: {
    collection: "flights", singular: "flight", plural: "Flights",
    title: (v) => [s(v.airline), s(v.flightNumber)].filter(Boolean).join(" ") || "Flight",
    subtitle: (v) => [`${s(v.from) || "?"} → ${s(v.to) || "?"}`, when(v.departAt)].filter(Boolean).join(" · "),
    fields: [
      { key: "airline", label: "Airline", type: "text", max: 80 },
      { key: "flightNumber", label: "Flight number", type: "text", required: true, max: 20 },
      { key: "from", label: "From", type: "text", required: true, max: 80 },
      { key: "to", label: "To", type: "text", required: true, max: 80 },
      { key: "departAt", label: "Departs (local time)", type: "datetime" },
      { key: "arriveAt", label: "Arrives (local time)", type: "datetime" },
      { key: "bookingRef", label: "Booking reference", type: "text", max: 40 },
      { key: "passengers", label: "Resources on this flight", type: "list", max: 100, hint: "One person or resource per line." },
      { key: "notes", label: "Notes", type: "textarea", max: 2000 },
    ],
  },
  hotels: {
    collection: "hotels", singular: "hotel", plural: "Hotels",
    title: (v) => s(v.name) || "Hotel",
    subtitle: (v) => [s(v.city), [s(v.checkIn), s(v.checkOut)].filter(Boolean).join(" → ")].filter(Boolean).join(" · "),
    fields: [
      { key: "name", label: "Hotel name", type: "text", required: true, max: 120 },
      { key: "address", label: "Address", type: "textarea", max: 400 },
      { key: "city", label: "City", type: "text", max: 80 },
      { key: "phone", label: "Phone", type: "text", max: 40 },
      { key: "checkIn", label: "Check in", type: "date" },
      { key: "checkOut", label: "Check out", type: "date" },
      { key: "bookingRef", label: "Booking reference", type: "text", max: 40 },
      { key: "guests", label: "Guests", type: "list", max: 100, hint: "One person per line." },
      { key: "notes", label: "Notes", type: "textarea", max: 2000 },
    ],
  },
  cars: {
    collection: "cars", singular: "hire car", plural: "Hire cars",
    title: (v) => [s(v.company), s(v.vehicle)].filter(Boolean).join(" · ") || "Hire car",
    subtitle: (v) => [when(v.pickUpAt), s(v.pickUpLocation)].filter(Boolean).join(" · "),
    fields: [
      { key: "company", label: "Hire company", type: "text", required: true, max: 80 },
      { key: "vehicle", label: "Vehicle", type: "text", max: 80 },
      { key: "registration", label: "Registration", type: "text", max: 20 },
      { key: "pickUpLocation", label: "Pick-up location", type: "text", max: 160 },
      { key: "pickUpAt", label: "Pick-up (local time)", type: "datetime" },
      { key: "dropOffLocation", label: "Drop-off location", type: "text", max: 160 },
      { key: "dropOffAt", label: "Drop-off (local time)", type: "datetime" },
      { key: "bookingRef", label: "Booking reference", type: "text", max: 40 },
      { key: "drivers", label: "Named drivers", type: "list", max: 20, hint: "One per line." },
      { key: "notes", label: "Notes", type: "textarea", max: 2000 },
    ],
  },
  assets: {
    collection: "assets", singular: "asset", plural: "Assets",
    title: (v) => s(v.name) || "Asset",
    subtitle: (v) => [s(v.category), s(v.serialNumber) && `S/N ${s(v.serialNumber)}`, s(v.carriedBy) && `with ${s(v.carriedBy)}`]
      .filter(Boolean).join(" · "),
    fields: [
      { key: "name", label: "Asset", type: "text", required: true, max: 120 },
      { key: "category", label: "Category", type: "text", max: 60, hint: "For example laptop, phone, radio, kit." },
      { key: "serialNumber", label: "Serial / asset number", type: "text", max: 60 },
      { key: "quantity", label: "Quantity", type: "number" },
      { key: "carriedBy", label: "Carried by", type: "text", max: 80 },
      { key: "returned", label: "Returned after the trip", type: "checkbox" },
      { key: "notes", label: "Notes", type: "textarea", max: 2000 },
    ],
  },
} satisfies Record<string, ItemSchema>;
export type ItemKind = keyof typeof ITEM_SCHEMAS;

/** Turn form strings into the stored shape, dropping blanks. Returns errors for required/oversize. */
export function cleanItem(schema: ItemSchema, raw: Record<string, unknown>): { value: Record<string, unknown>; errors: Record<string, string> } {
  const value: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of schema.fields) {
    const v = raw[f.key];
    if (f.type === "checkbox") { value[f.key] = v === true; continue; }
    if (f.type === "number") {
      const n = typeof v === "number" ? v : Number(s(v));
      if (s(v) === "" || Number.isNaN(n)) { if (f.required) errors[f.key] = `Enter ${f.label.toLowerCase()}.`; continue; }
      if (n < 0 || n > 100000 || !Number.isInteger(n)) { errors[f.key] = "Enter a whole number."; continue; }
      value[f.key] = n; continue;
    }
    if (f.type === "list") {
      const lines = (Array.isArray(v) ? v.map(s) : s(v).split("\n")).map((x) => x.trim()).filter(Boolean);
      if (lines.length > (f.max ?? 100)) errors[f.key] = `At most ${f.max} lines.`;
      if (lines.some((l) => l.length > 120)) errors[f.key] = "Keep each line under 120 characters.";
      value[f.key] = lines; continue;
    }
    const str = s(v).trim();
    if (!str) { if (f.required) errors[f.key] = `Enter ${f.label.toLowerCase()}.`; continue; }
    if (f.max && str.length > f.max) { errors[f.key] = `Keep this under ${f.max} characters.`; continue; }
    value[f.key] = str;
  }
  return { value, errors };
}

// ---- Requests to the Team Leader (with approval) -------------------------------------------------

/** What can be requested (spec §6). Each kind adds its own fields to the request form. */
export const REQUEST_KINDS = [
  { key: "resource", label: "Resource (people)" },
  { key: "flight", label: "Flight" },
  { key: "hotel", label: "Hotel" },
  { key: "car", label: "Hire car" },
  { key: "asset", label: "Asset" },
  { key: "cash", label: "Cash" },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]["key"];
export const kindLabel = (k: string) => REQUEST_KINDS.find((x) => x.key === k)?.label ?? "Request";

/**
 * pending → approved | rejected (Team Leader or HOST decides) → approved → completed (fulfilled).
 * A rejected request can be resubmitted by its creator (back to pending).
 */
export type TlRequestStatus = "pending" | "approved" | "rejected" | "completed";
export const REQUEST_STATUS_LABEL: Record<TlRequestStatus, string> = {
  pending: "Awaiting approval", approved: "Approved", rejected: "Rejected", completed: "Completed",
};
export const requestTone = (st: TlRequestStatus) =>
  st === "pending" ? "warn" : st === "approved" ? "info" : st === "rejected" ? "bad" : "ok";

export interface TlRequest {
  id: string;
  kind: RequestKind;
  title: string;
  details: string;
  quantity: number | null;
  amount: number | null;
  currency: string;
  neededBy: string;
  createdBy: string;
  createdByName: string;
  createdAtMs: number;
  status: TlRequestStatus;
  decidedByName: string;
  decidedAtMs: number;
  decisionNote: string;
  completedByName: string;
  completedAtMs: number;
  response: string;
}

/** Validates the request form. Quantity for people/assets, amount + currency for cash. */
export function validateTlRequest(r: { kind: string; title: string; quantity: string; amount: string; currency: string }): Record<string, string> {
  const e: Record<string, string> = {};
  if (!REQUEST_KINDS.some((k) => k.key === r.kind)) e.kind = "Choose a type.";
  if (!r.title.trim()) e.title = "Enter a title.";
  else if (r.title.trim().length > 120) e.title = "Keep under 120 characters.";
  if ((r.kind === "resource" || r.kind === "asset") && r.quantity.trim()) {
    const n = Number(r.quantity);
    if (!Number.isInteger(n) || n < 1 || n > 1000) e.quantity = "Enter a whole number.";
  }
  if (r.kind === "cash") {
    if (parseAmount(r.amount) === null || parseAmount(r.amount) === 0) e.amount = "Enter an amount.";
    if (!r.currency.trim()) e.currency = "Choose a currency.";
  }
  return e;
}

/** Needs action from the Team Leader: waiting for a decision, or approved but not yet done. */
export const openCount = (rs: TlRequest[]) => rs.filter((r) => r.status === "pending" || r.status === "approved").length;
export const pendingCount = (rs: TlRequest[]) => rs.filter((r) => r.status === "pending").length;

const STATUS_ORDER: Record<TlRequestStatus, number> = { pending: 0, approved: 1, rejected: 2, completed: 3 };
/** Pending first (oldest first, so nothing waits forever), then approved, rejected, completed (newest first). */
export const sortTlRequests = (rs: TlRequest[]) =>
  [...rs].sort((a, b) =>
    a.status !== b.status ? STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      : a.status === "pending" || a.status === "approved" ? a.createdAtMs - b.createdAtMs
        : Math.max(b.completedAtMs, b.decidedAtMs) - Math.max(a.completedAtMs, a.decidedAtMs));

// ---- Vaccination declarations ------------------------------------------------------------------

/**
 * One declaration per traveller (trips/{id}/vaccinations/{uid}). TODO(owner): confirm the required
 * vaccine list per country, who may read declarations (health data: currently the traveller, the
 * Team Leader and HOST), retention, and the declaration wording (spec §8).
 */
export interface VaccineRecord { name: string; date: string }
export interface VaccinationDeclaration {
  uid: string;
  name: string;
  vaccines: VaccineRecord[];
  notes: string;
  declared: boolean;
  declaredAtMs: number;
}
export const DECLARATION_TEXT = "I declare that the vaccination information above is accurate and complete.";

export function cleanVaccines(rows: VaccineRecord[]): VaccineRecord[] {
  return rows
    .map((r) => ({ name: r.name.trim().slice(0, 80), date: isIsoDate(r.date) ? r.date : "" }))
    .filter((r) => r.name)
    .slice(0, 30);
}

// ---- Debrief ----------------------------------------------------------------------------------

export interface Debrief {
  wentWell: string;
  couldBeBetter: string;
  welfareConcerns: string;
  injuryRefs: string[];
  reciprocityIssues: boolean;
  reciprocityDescription: string;
  updatedBy: string;
  updatedAtMs: number;
}

export const EMPTY_DEBRIEF: Debrief = {
  wentWell: "", couldBeBetter: "", welfareConcerns: "", injuryRefs: [],
  reciprocityIssues: false, reciprocityDescription: "", updatedBy: "", updatedAtMs: 0,
};

/** Injury report reference numbers: one per line, trimmed, de-duplicated, ≤ 20 of ≤ 60 chars. */
export function cleanInjuryRefs(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/[\n,]/)) {
    const v = line.trim().slice(0, 60);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 20);
}

// ---- Financial debrief ---------------------------------------------------------------------------

/** TODO(owner): confirm the finance categories and whether a cost-code / budget field is needed. */
export const FINANCE_CATEGORIES = ["Flights", "Accommodation", "Car hire", "Fuel", "Subsistence", "Transport", "Equipment", "Other"] as const;
export const CURRENCIES = ["GBP", "EUR", "USD", "Other"] as const;
export const PAYMENT_METHODS = ["Company card", "Personal (claim)", "Cash advance", "Invoice", "Other"] as const;

export interface FinanceEntry {
  id: string;
  ownerUid: string;
  ownerName: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  receiptRef: string;
  updatedAtMs: number;
}

/** Parse "12.50" / "£1,200" into pence-accurate pounds; null when not a positive amount ≤ 1,000,000. */
export function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/[£$€,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}

/** Totals per currency, per person (currencies are never added together). */
export function financeTotals(entries: FinanceEntry[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const e of entries) {
    const p = (out[e.ownerUid] ??= {});
    p[e.currency] = Math.round(((p[e.currency] ?? 0) + e.amount) * 100) / 100;
  }
  return out;
}

export const formatMoney = (amount: number, currency: string) =>
  /^[A-Z]{3}$/.test(currency)
    ? new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(amount)
    : `${amount.toFixed(2)} ${currency}`;

// ---- Messages ---------------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  senderUid: string;
  senderName: string;
  text: string;
  createdAtMs: number;
  pending: boolean;
}

export const MAX_MESSAGE = 4000;

/** Day separators like TrackLink's chat: "Today", "Yesterday", or a date. */
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(n) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: diff < 7 ? "long" : undefined, day: "numeric", month: "short", year: d.getFullYear() === n.getFullYear() ? undefined : "numeric" });
}

/** Consecutive messages from one sender within 5 minutes form a run (one name, tighter spacing). */
export function startsRun(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  return !prev || prev.senderUid !== m.senderUid || m.createdAtMs - prev.createdAtMs > 5 * 60_000
    || dayLabel(prev.createdAtMs) !== dayLabel(m.createdAtMs);
}

/** Where the unread line goes: the first message after my last read that is not mine. */
export function firstUnreadIndex(ms: ChatMessage[], readAtMs: number, uid: string): number {
  return ms.findIndex((m) => m.createdAtMs > readAtMs && m.senderUid !== uid);
}

// ---- Attachments ------------------------------------------------------------------------------

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** A Storage-safe object name: the original name kept readable, anything odd replaced. */
export const safeFileName = (name: string) =>
  name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "file";

// ---- Terms ------------------------------------------------------------------------------------

/** Bump when the documents change; every sign-in records the versions agreed to. */
export const TERMS_VERSION = "draft-0";
export const PRIVACY_VERSION = "draft-0";
