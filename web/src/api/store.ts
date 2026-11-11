/**
 * The Laravel/AWS backend for every screen — the same exports as ../store.ts (Firebase), so no
 * component changes. Selected at build time with VITE_BACKEND=laravel (vite.config.ts swaps the
 * module). `conformance.ts` makes the TypeScript build fail if the two drift apart.
 *
 * The server stamps every author and time and decides every permission; nothing here is trusted.
 */
import { useEffect, useState } from "react";
import { api, clearPolls, onSessionLost, refresh, resetCsrf, usePoll } from "./client";
import {
  type ChatMessage, type Contact, type ContactInput, type Debrief, EMPTY_DEBRIEF, type FinanceEntry, MAX_ATTACHMENT_BYTES, type RequestInput,
  type RoleHolder, type TlRequest, toRequestStatus, type Trip, type TripContact, type TripRequest, type TripRoleKey, type TripStatus,
  type VaccinationDeclaration, type VaccineRecord,
} from "../model";

/** Kept for the passkeys module's signature; the API has no generic callable endpoint. */
export const call = async <T,>(name: string, _data: unknown = {}): Promise<T> => {
  throw new Error(`Unknown action ${name}.`);
};

// ---- Session ----------------------------------------------------------------------------------

export interface Session {
  user: { uid: string; email: string | null };
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isHost: boolean;
  isAdmin: boolean;
  isController: boolean;
  isSpcProfile: boolean;
}
interface SessionJson { uid: string; email: string; name: string; emailVerified: boolean; isHost: boolean; isAdmin: boolean; isController: boolean; isSpcProfile: boolean }

const toSession = (u: SessionJson | null): Session | null => (u ? { ...u, user: { uid: u.uid, email: u.email } } : null);

let current: Session | null | undefined;
const listeners = new Set<(s: Session | null) => void>();
function setSession(s: Session | null) {
  if (current?.uid !== s?.uid) clearPolls();
  current = s;
  listeners.forEach((f) => f(s));
}
/** Re-read who is signed in (after sign-in, sign-out, confirming the email). */
export async function reloadSession(): Promise<Session | null> {
  const r = await api<{ user: SessionJson | null }>("GET", "auth/session").catch(() => ({ user: null }));
  setSession(toSession(r.user));
  return current ?? null;
}
onSessionLost(() => { if (current) setSession(null); });

/** undefined = still loading, null = signed out. */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(current);
  useEffect(() => {
    listeners.add(setS);
    if (current === undefined) void reloadSession();
    // Notice a session ended on the server (idle timeout, disabled) even when nothing else polls.
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible" && current) {
        api<{ user: SessionJson | null }>("GET", "auth/session", undefined, { background: true })
          .then((r) => { if (!r.user) setSession(null); }, () => undefined);
      }
    }, 60_000);
    return () => { listeners.delete(setS); window.clearInterval(t); };
  }, []);
  return s;
}

export async function refreshSession(): Promise<boolean> {
  const s = await reloadSession();
  return !!s?.emailVerified;
}

export async function signOutApi() {
  await api("POST", "auth/logout").catch(() => undefined);
  resetCsrf();
  setSession(null);
}

export type AgreementMethod = "signup" | "password" | "passkey";
/** The agreement is recorded by the server as part of every sign-in (MIGRATION-PLAN §7 item 5). */
export const recordAgreement = async (_method: AgreementMethod) => undefined;

export const syncPendingAccess = () => api<{ added: number }>("POST", "me/sync-pending").then((r) => { refresh("trips"); return r; });

// ---- Trip requests ----------------------------------------------------------------------------

const toRequest = (v: TripRequest): TripRequest => ({ ...v, status: v.status === "accepted" || v.status === "declined" ? v.status : "submitted" });

export function submitRequest(_s: Session, r: RequestInput) {
  return api<{ id: string }>("POST", "trip-requests", { teamName: r.teamName.trim(), startDate: r.startDate, endDate: r.endDate, location: r.location.trim() })
    .then((x) => { refresh("trip-requests"); return x; });
}
export function useRequests(_s: Session): TripRequest[] | null {
  return usePoll("trip-requests", (j) => (j.requests as TripRequest[]).map(toRequest), []);
}
export function useRequest(id: string): TripRequest | null | undefined {
  const r = usePoll<TripRequest | "missing">(`trip-requests/${encodeURIComponent(id)}`, (j) => toRequest(j.request), "missing");
  return r === null ? undefined : r === "missing" ? null : r;
}
export const declineRequest = (id: string, reason: string) =>
  api("POST", `trip-requests/${encodeURIComponent(id)}/decline`, { reason: reason.trim().slice(0, 500) }).then(() => refresh("trip-requests"));

export interface CreateTripInput {
  requestId: string; name: string; cyberRisk: string; cyberRationale: string; countryRisk: string; countryRationale: string;
  roles: Partial<Record<TripRoleKey, RoleHolder>>;
}
export const createTrip = (input: CreateTripInput) =>
  api<{ tripId: string }>("POST", "trips", input).then((r) => { refresh("trips", "trip-requests"); return r; });

// ---- Trips ------------------------------------------------------------------------------------

const T = (id: string) => `trips/${encodeURIComponent(id)}`;
const toTrip = (v: Partial<Trip>): Trip => ({
  id: v.id ?? "", name: v.name ?? "", teamName: v.teamName ?? "", location: v.location ?? "", startDate: v.startDate ?? "", endDate: v.endDate ?? "",
  status: (["planning", "live", "archived"].includes(v.status as string) ? v.status : "planning") as TripStatus,
  cyberRisk: v.cyberRisk ?? "", cyberRationale: v.cyberRationale ?? "", countryRisk: v.countryRisk ?? "", countryRationale: v.countryRationale ?? "",
  roles: (v.roles && !Array.isArray(v.roles) ? v.roles : {}) as Trip["roles"], memberUids: v.memberUids ?? [], pendingEmails: v.pendingEmails ?? [],
  requestId: v.requestId ?? null, createdByName: v.createdByName ?? "", createdByEmail: v.createdByEmail ?? "", dipAgreed: v.dipAgreed === true,
  dipAgreedDate: v.dipAgreedDate ?? "", dipClassification: v.dipClassification ?? "", updatedByName: v.updatedByName ?? "",
  updatedAtMs: v.updatedAtMs ?? 0, createdAtMs: v.createdAtMs ?? 0,
});

export function useTrips(_s: Session): Trip[] | null {
  return usePoll("trips", (j) => (j.trips as Partial<Trip>[]).map(toTrip), []);
}
export function useTrip(id: string): Trip | null | undefined {
  const t = usePoll<Trip | null | "missing">(T(id), (j) => toTrip(j.trip), "missing");
  return t === null ? undefined : t === "missing" ? null : t;
}

export interface MemberProfile { uid: string; name: string; email: string; reasons: string[]; addedByName: string; addedAtMs: number }
export function useMembers(tripId: string): MemberProfile[] | null {
  return usePoll(`${T(tripId)}/members`, (j) => j.members as MemberProfile[], []);
}

const patchTrip = (id: string, body: Record<string, unknown>) => api("PATCH", T(id), body).then(() => refresh(T(id), "trips"));
export const updateTripOverview = (id: string, patch: Partial<Pick<Trip, "name" | "teamName" | "location" | "startDate" | "endDate" | "cyberRisk" | "cyberRationale" | "countryRisk" | "countryRationale" | "createdByName" | "createdByEmail">>) =>
  patchTrip(id, patch);
export const setTripStatus = (id: string, status: TripStatus) => patchTrip(id, { status });
export const setDipClassification = (id: string, value: string) => patchTrip(id, { dipClassification: value });
export const setDipAgreed = (id: string, agreed: boolean, date: string) => patchTrip(id, { dipAgreed: agreed, dipAgreedDate: agreed ? date : "" });

export const updateTripRoles = (tripId: string, roles: Partial<Record<TripRoleKey, RoleHolder>>) =>
  api("PUT", `${T(tripId)}/roles`, { roles }).then(() => refresh(T(tripId), "trips"));
export const addTripAccess = (tripId: string, target: { uid?: string; email?: string }) =>
  api<{ status: "added" | "pending" | "already" }>("POST", `${T(tripId)}/access`, target).then((r) => { refresh(T(tripId)); return r; });
export const removeTripAccess = (tripId: string, target: { uid?: string; email?: string }) =>
  api<{ stillOnTripAs: string[] }>("POST", `${T(tripId)}/access/remove`, target).then((r) => { refresh(T(tripId)); return r; });

// ---- Planning items ---------------------------------------------------------------------------

export interface Item { id: string; values: Record<string, unknown>; createdByName: string; updatedAtMs: number }
export function useItems(tripId: string, coll: string): Item[] | null {
  return usePoll(`${T(tripId)}/items/${coll}`, (j) => j.items as Item[], []);
}
export const addItem = (_s: Session, tripId: string, coll: string, values: Record<string, unknown>) =>
  api<{ id: string }>("POST", `${T(tripId)}/items/${coll}`, { values }).then((r) => { refresh(T(tripId)); return r; });
/** The server replaces the item's fields and always clears an SPC decision on edit. */
export const updateItem = (tripId: string, coll: string, id: string, values: Record<string, unknown>, keys: string[]) =>
  api("PUT", `${T(tripId)}/items/${coll}/${encodeURIComponent(id)}`, { values: Object.fromEntries(keys.filter((k) => k in values && !k.startsWith("spc")).map((k) => [k, values[k]])) })
    .then(() => refresh(T(tripId)));
export const deleteItem = (tripId: string, coll: string, id: string) =>
  api("DELETE", `${T(tripId)}/items/${coll}/${encodeURIComponent(id)}`).then(() => refresh(T(tripId)));
export const decideFlight = (_s: Session, tripId: string, id: string, decision: "approved" | "not_approved", rationale: string) =>
  api("POST", `${T(tripId)}/flights/${encodeURIComponent(id)}/decision`, { decision, rationale: rationale.trim().slice(0, 2000) }).then(() => refresh(`${T(tripId)}/items/flights`));

// ---- Messages ---------------------------------------------------------------------------------

export function useMessages(tripId: string): ChatMessage[] | null {
  return usePoll(`${T(tripId)}/messages`, (j) => j.messages as ChatMessage[], [], 5_000);
}
export const sendMessage = (_s: Session, tripId: string, text: string) =>
  api("POST", `${T(tripId)}/messages`, { text }).then(() => refresh(`${T(tripId)}/messages`));
export const deleteMessage = (tripId: string, id: string) =>
  api("DELETE", `${T(tripId)}/messages/${encodeURIComponent(id)}`).then(() => refresh(`${T(tripId)}/messages`));
export function useReadAt(_uid: string, tripId: string): number | null {
  return usePoll(`${T(tripId)}/read`, (j) => Number(j.readAtMs) || 0, 0, 30_000);
}
export const markRead = (_uid: string, tripId: string) => api("POST", `${T(tripId)}/read`).then(() => refresh(`${T(tripId)}/read`));

// ---- Attachments ------------------------------------------------------------------------------

export interface Attachment { id: string; name: string; path: string; size: number; contentType: string; uploadedByName: string; uploadedBy: string; createdAtMs: number }
const attachmentsPath = (tripId: string) => `${T(tripId)}/attachments`;
export function useAttachments(tripId: string): Attachment[] | null {
  return usePoll(attachmentsPath(tripId), (j) => j.attachments as Attachment[], []);
}
/** Uploads through the API (never straight to S3), reporting progress. */
export async function uploadAttachment(_s: Session, tripId: string, file: File, onProgress: (pct: number) => void) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("That file is larger than 25 MB.");
  // The raw XHR (for progress) needs the CSRF cookie the fetch wrapper normally fetches.
  if (!document.cookie.includes("XSRF-TOKEN=")) await fetch("/sanctum/csrf-cookie", { credentials: "same-origin" });
  const token = decodeURIComponent(document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1] ?? "");
  const form = new FormData();
  form.append("file", file);
  await new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `/api/v1/${attachmentsPath(tripId)}`);
    x.withCredentials = true;
    x.setRequestHeader("Accept", "application/json");
    x.setRequestHeader("X-XSRF-TOKEN", token);
    x.upload.onprogress = (e) => onProgress(Math.round((e.loaded / Math.max(1, e.total)) * 100));
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error((() => { try { return JSON.parse(x.responseText).message; } catch { return "Upload failed."; } })())));
    x.onerror = () => reject(new Error("No connection. Try again."));
    x.send(form);
  });
  refresh(attachmentsPath(tripId));
}
/** `path` is the API download URL (same origin; the access check runs on every download). */
export const attachmentUrl = async (a: Attachment) => (a.path.startsWith("/api/v1/") ? a.path : "");
export async function openAttachment(a: Attachment) {
  const url = await attachmentUrl(a);
  if (!url) throw new Error("This file can't be opened.");
  window.open(url, "_blank", "noopener");
}
export async function deleteAttachment(tripId: string, a: Attachment) {
  await api("DELETE", `${attachmentsPath(tripId)}/${encodeURIComponent(a.id)}`);
  refresh(attachmentsPath(tripId));
}

// ---- Requests to the Team Leader ---------------------------------------------------------------

const toTl = (v: TlRequest): TlRequest => ({ ...v, status: toRequestStatus(v.status) });
export function useTlRequests(tripId: string): TlRequest[] | null {
  return usePoll(`${T(tripId)}/requests`, (j) => (j.requests as TlRequest[]).map(toTl), []);
}
export interface TlRequestInput { kind: TlRequest["kind"]; title: string; details: string; quantity: number | null; amount: number | null; currency: string; neededBy: string }
export const addTlRequest = (_s: Session, tripId: string, r: TlRequestInput) =>
  api("POST", `${T(tripId)}/requests`, {
    kind: r.kind, title: r.title.trim(), details: r.details.trim(), quantity: r.quantity, amount: r.amount,
    currency: r.amount !== null ? r.currency : "", neededBy: r.neededBy,
  }).then(() => refresh(`${T(tripId)}/requests`));
export const decideTlRequest = (_s: Session, tripId: string, id: string, approve: boolean, note: string) =>
  api("POST", `${T(tripId)}/requests/${encodeURIComponent(id)}/decide`, { approve, note: note.trim().slice(0, 1000) }).then(() => refresh(`${T(tripId)}/requests`));
export const resubmitTlRequest = (tripId: string, id: string) =>
  api("POST", `${T(tripId)}/requests/${encodeURIComponent(id)}/resubmit`).then(() => refresh(`${T(tripId)}/requests`));
export const deleteTlRequest = (tripId: string, id: string) =>
  api("DELETE", `${T(tripId)}/requests/${encodeURIComponent(id)}`).then(() => refresh(`${T(tripId)}/requests`));

// ---- Summaries --------------------------------------------------------------------------------

export type SummaryRole = "teamLeader" | "spc";
export interface Summary { text: string; byName: string; updatedAtMs: number }
export function useSummaries(tripId: string): Record<SummaryRole, Summary | null> | null {
  return usePoll(`${T(tripId)}/summaries`, (j) => j.summaries as Record<SummaryRole, Summary | null>, { teamLeader: null, spc: null });
}
export const saveSummary = (_s: Session, tripId: string, role: SummaryRole, text: string) =>
  api("PUT", `${T(tripId)}/summaries/${role}`, { text: text.trim().slice(0, 5000) }).then(() => refresh(`${T(tripId)}/summaries`));

// ---- Vaccination declarations (health data) --------------------------------------------------------

export function useVaccinations(tripId: string, _uid: string, all: boolean): VaccinationDeclaration[] | null {
  return usePoll(`${T(tripId)}/vaccinations${all ? "?all=1" : ""}`, (j) => j.vaccinations as VaccinationDeclaration[], [], 60_000);
}
export const saveVaccination = (_s: Session, tripId: string, vaccines: VaccineRecord[], notes: string, declared: boolean) =>
  api("PUT", `${T(tripId)}/vaccinations`, { vaccines, notes: notes.trim().slice(0, 2000), declared }).then(() => refresh(`${T(tripId)}/vaccinations`));

// ---- Debrief ----------------------------------------------------------------------------------

export function useDebrief(tripId: string): Debrief | null {
  return usePoll(`${T(tripId)}/debrief`, (j) => j.debrief as Debrief, EMPTY_DEBRIEF, 60_000);
}
export const saveDebrief = (_s: Session, tripId: string, d: Omit<Debrief, "updatedBy" | "updatedAtMs">) =>
  api("PUT", `${T(tripId)}/debrief`, d).then(() => refresh(`${T(tripId)}/debrief`));

// ---- Contacts book ----------------------------------------------------------------------------

export function useContacts(): Contact[] | null {
  return usePoll("contacts", (j) => j.contacts as Contact[], [], 60_000);
}
export async function saveContact(_s: Session, id: string | null, c: ContactInput): Promise<string> {
  const r = await api<{ id: string }>(id ? "PUT" : "POST", id ? `contacts/${encodeURIComponent(id)}` : "contacts", c);
  refresh("contacts");
  return r.id;
}
export const deleteContact = (id: string) => api("DELETE", `contacts/${encodeURIComponent(id)}`).then(() => refresh("contacts"));
export function useTripContacts(tripId: string): TripContact[] | null {
  return usePoll(`${T(tripId)}/contacts`, (j) => j.contacts as TripContact[], [], 60_000);
}
export const addContactToTrip = (_s: Session, tripId: string, c: Contact, tripRole: string) =>
  api("PUT", `${T(tripId)}/contacts/${encodeURIComponent(c.id)}`, { tripRole: tripRole.trim().slice(0, 80) }).then(() => refresh(`${T(tripId)}/contacts`));
export const removeTripContact = (tripId: string, id: string) =>
  api("DELETE", `${T(tripId)}/contacts/${encodeURIComponent(id)}`).then(() => refresh(`${T(tripId)}/contacts`));

// ---- Administration ---------------------------------------------------------------------------

export const setRole = (email: string, role: "host" | "controller", on: boolean) => api<{ uid: string }>("POST", "admin/role", { email, role, on });

export interface DirectoryPerson { uid: string; name: string; email: string; spc?: boolean }
export function useDirectory(): DirectoryPerson[] | null {
  return usePoll("directory", (j) => (j.people as DirectoryPerson[]).filter((p) => p.name), [], 120_000);
}
/** The directory is the list of confirmed accounts on the server; nothing to write. */
export const upsertDirectory = async (_s: Session) => undefined;

export function useControllerLiveTrips(s: Session): Trip[] | null {
  return usePoll(s.isController ? "live-trips" : null, (j) => (j.trips as Partial<Trip>[]).map(toTrip), [], 60_000);
}

// ---- Financial debrief ------------------------------------------------------------------------

type FinanceJson = { entries: FinanceEntry[]; notes: Record<string, { name: string; text: string; updatedAtMs: number }> };
export function useFinanceEntries(tripId: string): FinanceEntry[] | null {
  return usePoll(`${T(tripId)}/finance`, (j: FinanceJson) => j.entries, []);
}
export const saveFinanceEntry = (_s: Session, tripId: string, id: string | null, e: Omit<FinanceEntry, "id" | "ownerUid" | "ownerName" | "updatedAtMs">) =>
  api(id ? "PUT" : "POST", id ? `${T(tripId)}/finance/${encodeURIComponent(id)}` : `${T(tripId)}/finance`, e).then(() => refresh(`${T(tripId)}/finance`));
export const deleteFinanceEntry = (tripId: string, id: string) =>
  api("DELETE", `${T(tripId)}/finance/${encodeURIComponent(id)}`).then(() => refresh(`${T(tripId)}/finance`));
export function useFinanceNotes(tripId: string): Record<string, { name: string; text: string; updatedAtMs: number }> | null {
  return usePoll(`${T(tripId)}/finance`, (j: FinanceJson) => j.notes, {});
}
export const saveFinanceNote = (_s: Session, tripId: string, text: string) =>
  api("PUT", `${T(tripId)}/finance-note`, { text: text.trim() }).then(() => refresh(`${T(tripId)}/finance`));

// ---- Whole-trip export ------------------------------------------------------------------------

export interface TripSnapshot {
  trip: Trip; members: MemberProfile[]; items: Record<string, Item[]>; messages: ChatMessage[]; attachments: Attachment[]; tlRequests: TlRequest[];
  summaries: Record<"teamLeader" | "spc", { text: string; byName: string } | null>; contacts: TripContact[]; vaccinations: VaccinationDeclaration[];
  debrief: Debrief; finance: FinanceEntry[]; financeNotes: Record<string, { name: string; text: string }>;
}
export async function loadTripSnapshot(tripId: string): Promise<TripSnapshot> {
  const { snapshot } = await api<{ snapshot: TripSnapshot & { trip: Partial<Trip> } }>("GET", `${T(tripId)}/snapshot`);
  return { ...snapshot, trip: toTrip(snapshot.trip), tlRequests: snapshot.tlRequests.map(toTl) };
}

// ---- Account manager --------------------------------------------------------------------------

export interface RoleProfiles { host: boolean; controller: boolean; spc: boolean; admin: boolean }
export interface ManagedAccount {
  uid: string; name: string; email: string; emailVerified: boolean; disabled: boolean; invited: boolean;
  roles: RoleProfiles; createdAt: string; lastSignIn: string;
}
export const listAccounts = () => api<{ accounts: ManagedAccount[] }>("GET", "admin/accounts").then((r) => r.accounts.map((a) => ({ ...a, invited: !a.lastSignIn })));
/** The set-password link is EMAILED to the person; it is never shown to the administrator. */
export const createAccount = (a: { name: string; email: string; roles: RoleProfiles }) => api<{ uid: string; setupLink: string }>("POST", "admin/accounts", a);
export const setAccountRoles = (uid: string, roles: RoleProfiles) => api("PUT", `admin/accounts/${encodeURIComponent(uid)}/roles`, { roles });
export const deleteManagedAccount = (uid: string) => api("DELETE", `admin/accounts/${encodeURIComponent(uid)}`);

export async function myTripReasons(tripId: string, uid: string): Promise<string[]> {
  const r = await api<{ members: MemberProfile[] }>("GET", `${T(tripId)}/members`).catch(() => ({ members: [] as MemberProfile[] }));
  return r.members.find((m) => m.uid === uid)?.reasons ?? [];
}

// ---- Notifications ----------------------------------------------------------------------------

export interface AppNotification { id: string; type: string; title: string; body: string; tripId: string; link: string; read: boolean; createdAtMs: number }
export function useNotifications(_uid: string): AppNotification[] | null {
  return usePoll("notifications", (j) => j.notifications as AppNotification[], [], 15_000);
}
export const markNotificationRead = (_uid: string, id: string) => api("POST", `notifications/${encodeURIComponent(id)}/read`).then(() => refresh("notifications"));
export const clearNotification = (_uid: string, id: string) => api("DELETE", `notifications/${encodeURIComponent(id)}`).then(() => refresh("notifications"));

/** Push on this device: standard Web Push (VAPID) — no Firebase. */
export type PushState = "unsupported" | "blocked" | "off" | "on";
export async function pushState(): Promise<PushState> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  return Notification.permission === "granted" && (await reg?.pushManager.getSubscription()) ? "on" : "off";
}
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
export async function enablePush(_uid: string): Promise<PushState> {
  if ((await pushState()) === "unsupported") return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "blocked" : "off";
  const { publicKey } = await api<{ publicKey: string }>("GET", "push/key");
  if (!publicKey) throw new Error("Push is not set up on this server yet.");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api("POST", "push/subscriptions", sub.toJSON());
  return "on";
}
export async function disablePush(_uid: string) {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("POST", "push/subscriptions/remove", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}
