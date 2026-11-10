/**
 * DEMO store — same exports as ../store.ts, backed by demo/backend.ts instead of Firebase.
 * The work the Cloud Functions do in production (createTrip, access, agreements, HOST role) is
 * done here in the page. There are no security rules in the demo: it is for trying the screens.
 */
import { useEffect, useState } from "react";
import {
  EMPTY_DEBRIEF, MAX_ATTACHMENT_BYTES, PRIVACY_VERSION, REQUEST_KINDS, TERMS_VERSION,
  type ChatMessage, type Debrief, type FinanceEntry, type RequestInput, type RequestKind, type RoleHolder, type TlRequest,
  type TlRequestStatus, type Trip, type TripRequest, type TripRoleKey, type TripStatus, type VaccinationDeclaration, type VaccineRecord,
} from "../model";
import { DELETE, be, type QuerySpec, type Snap } from "./backend";

const now = () => Date.now();
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);
const ms = (v: unknown) => (typeof v === "number" ? v : 0);

function useColl<T>(path: string | null, q: QuerySpec, map: (s: Snap) => T, key = ""): T[] | null {
  const [list, setList] = useState<T[] | null>(null);
  useEffect(() => {
    setList(null);
    if (!path) return;
    return be().watchCollection(path, q, (docs) => setList(docs.map(map)), () => setList([]));
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}
function useDocOf<T>(path: string, map: (s: Snap | null) => T): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => be().watchDoc(path, (d) => setV(map(d)), () => setV(map(null))), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

// ---- Session (demo accounts) -------------------------------------------------------------------

export interface Session { uid: string; email: string; name: string; emailVerified: boolean; isHost: boolean; isAdmin: boolean }
export interface Account { name: string; email: string; emailVerified: boolean; host: boolean; passkeys: { id: string; label: string; createdAtMs: number; lastUsedAtMs: number }[] }

const SIGNED_IN = "op.demo.signedIn";
let signedIn = (() => { try { return localStorage.getItem(SIGNED_IN) === "1"; } catch { return false; } })();
const sessionListeners = new Set<() => void>();
export function setSignedIn(v: boolean) {
  signedIn = v;
  try { localStorage.setItem(SIGNED_IN, v ? "1" : "0"); } catch { /* ignore */ }
  sessionListeners.forEach((l) => l());
}
export const accountPath = () => `accounts/${be().uid}`;
export const toAccount = (s: Snap | null): Account | null => s ? {
  name: str(s.data.name), email: str(s.data.email), emailVerified: s.data.emailVerified === true, host: s.data.host === true,
  passkeys: Array.isArray(s.data.passkeys) ? s.data.passkeys as Account["passkeys"] : [],
} : null;

export function useAccount(): Account | null | undefined {
  return useDocOf(accountPath(), toAccount);
}

export function useSession(): Session | null | undefined {
  const account = useAccount();
  const [, tick] = useState(0);
  useEffect(() => { const l = () => tick((x) => x + 1); sessionListeners.add(l); return () => { sessionListeners.delete(l); }; }, []);
  if (account === undefined) return undefined;
  if (!signedIn || !account) return null;
  return {
    uid: be().uid, email: account.email, name: account.name || account.email, emailVerified: account.emailVerified,
    isHost: account.host, isAdmin: true,
  };
}

export async function refreshSession(): Promise<boolean> {
  return toAccount(await be().get(accountPath()))?.emailVerified ?? false;
}

export type AgreementMethod = "signup" | "password" | "passkey";

export async function recordAgreement(method: AgreementMethod) {
  await be().set(`users/${be().uid}/agreements/${be().newId()}`, {
    termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method, userAgent: navigator.userAgent.slice(0, 400), acceptedAt: now(),
  });
}

async function accountByEmail(email: string): Promise<{ uid: string; name: string } | null> {
  const hits = await be().list("accounts", { where: [["email", "==", email.toLowerCase()]] });
  const v = hits.find((h) => h.data.emailVerified === true);
  return v ? { uid: v.id, name: str(v.data.name) } : null;
}

export async function syncPendingAccess() {
  const me = toAccount(await be().get(accountPath()));
  if (!me?.emailVerified) return { added: 0 };
  const trips = await be().list("trips", { where: [["pendingEmails", "array-contains", me.email]] });
  for (const t of trips) {
    const roles = (t.data.roles ?? {}) as Record<string, RoleHolder>;
    for (const r of Object.values(roles)) if (r?.email === me.email) r.uid = be().uid;
    await be().patch(`trips/${t.id}`, {
      roles, memberUids: [...new Set([...(t.data.memberUids as string[] ?? []), be().uid])],
      pendingEmails: (t.data.pendingEmails as string[] ?? []).filter((e) => e !== me.email),
    });
    await be().set(`trips/${t.id}/members/${be().uid}`, { name: me.name, email: me.email, addedByName: "Invitation", addedAt: now() });
  }
  return { added: trips.length };
}

// ---- Trip requests ----------------------------------------------------------------------------

const toRequest = (s: Snap): TripRequest => {
  const v = s.data;
  return {
    id: s.id, teamName: str(v.teamName), startDate: str(v.startDate), endDate: str(v.endDate), location: str(v.location),
    requesterUid: str(v.requesterUid), requesterName: str(v.requesterName), requesterEmail: str(v.requesterEmail),
    status: v.status === "accepted" || v.status === "declined" ? v.status : "submitted",
    tripId: typeof v.tripId === "string" ? v.tripId : null, declineReason: str(v.declineReason), createdAtMs: ms(v.createdAt),
  };
};

export const submitRequest = (s: Session, r: RequestInput) =>
  be().set(`tripRequests/${be().newId()}`, {
    teamName: r.teamName.trim(), startDate: r.startDate, endDate: r.endDate, location: r.location.trim(),
    requesterUid: s.uid, requesterName: s.name.slice(0, 80), requesterEmail: s.email, status: "submitted", createdAt: now(),
  });

export const useRequests = (s: Session) =>
  useColl("tripRequests", s.isHost ? { orderBy: ["createdAt", "desc"] } : { where: [["requesterUid", "==", s.uid]], orderBy: ["createdAt", "desc"] }, toRequest, `${s.uid}${s.isHost}`);

export const useRequest = (id: string) => useDocOf(`tripRequests/${id}`, (d) => (d ? toRequest(d) : null));

export const declineRequest = (id: string, reason: string) =>
  be().patch(`tripRequests/${id}`, { status: "declined", declineReason: reason.trim().slice(0, 500), decidedAt: now() });

export interface CreateTripInput {
  requestId: string; name: string; cyberRisk: string; cyberRationale: string; countryRisk: string; countryRationale: string;
  roles: Partial<Record<TripRoleKey, RoleHolder>>;
}

async function resolveRoles(roles: Partial<Record<TripRoleKey, RoleHolder>>) {
  const out: Partial<Record<TripRoleKey, RoleHolder>> = {};
  for (const [k, r] of Object.entries(roles)) {
    if (!r) continue;
    const u = r.email ? await accountByEmail(r.email) : null;
    out[k as TripRoleKey] = { name: r.name || r.email.split("@")[0], email: r.email, uid: u?.uid ?? null };
  }
  return out;
}

export async function createTrip(input: CreateTripInput) {
  const req = await be().get(`tripRequests/${input.requestId}`);
  if (!req || req.data.status !== "submitted") throw new Error("This request has already been handled.");
  const me = toAccount(await be().get(accountPath()));
  const roles = await resolveRoles(input.roles);
  const members = new Map<string, { name: string; email: string }>();
  members.set(str(req.data.requesterUid), { name: str(req.data.requesterName), email: str(req.data.requesterEmail) });
  const pending = new Set<string>();
  for (const h of Object.values(roles)) { if (!h) continue; if (h.uid) members.set(h.uid, { name: h.name, email: h.email }); else if (h.email) pending.add(h.email); }
  const tripId = be().newId();
  await be().set(`trips/${tripId}`, {
    name: input.name, teamName: req.data.teamName, location: req.data.location, startDate: req.data.startDate, endDate: req.data.endDate,
    status: "planning", cyberRisk: input.cyberRisk, cyberRationale: input.cyberRationale, countryRisk: input.countryRisk,
    countryRationale: input.countryRationale, roles, memberUids: [...members.keys()], pendingEmails: [...pending],
    requestId: input.requestId, createdBy: be().uid, createdByName: me?.name ?? "", createdByEmail: me?.email ?? "",
    createdAt: now(), updatedAt: now(),
  });
  for (const [uid, m] of members) await be().set(`trips/${tripId}/members/${uid}`, { ...m, addedByName: me?.name ?? "HOST", addedAt: now() });
  await be().patch(`tripRequests/${input.requestId}`, { status: "accepted", tripId, decidedAt: now() });
  return { tripId };
}

// ---- Trips ------------------------------------------------------------------------------------

const toTrip = (s: Snap): Trip => {
  const v = s.data;
  const roles: Trip["roles"] = {};
  for (const [k, r] of Object.entries((v.roles ?? {}) as Record<string, Record<string, unknown>>)) {
    roles[k as TripRoleKey] = { name: str(r?.name), email: str(r?.email), uid: typeof r?.uid === "string" ? r.uid : null };
  }
  return {
    id: s.id, name: str(v.name), teamName: str(v.teamName), location: str(v.location), startDate: str(v.startDate), endDate: str(v.endDate),
    status: (["planning", "live", "archived"].includes(v.status as string) ? v.status : "planning") as TripStatus,
    cyberRisk: str(v.cyberRisk), cyberRationale: str(v.cyberRationale), countryRisk: str(v.countryRisk), countryRationale: str(v.countryRationale),
    roles, memberUids: Array.isArray(v.memberUids) ? v.memberUids as string[] : [], pendingEmails: Array.isArray(v.pendingEmails) ? v.pendingEmails as string[] : [],
    requestId: typeof v.requestId === "string" ? v.requestId : null, createdByName: str(v.createdByName), createdByEmail: str(v.createdByEmail),
    dipAgreed: v.dipAgreed === true, dipAgreedDate: str(v.dipAgreedDate), dipClassification: str(v.dipClassification),
    createdAtMs: ms(v.createdAt),
  };
};

export const useTrips = (s: Session) =>
  useColl("trips", s.isHost ? {} : { where: [["memberUids", "array-contains", s.uid]] }, toTrip, `${s.uid}${s.isHost}`);

export const useTrip = (id: string) => useDocOf(`trips/${id}`, (d) => (d ? toTrip(d) : null));

export interface MemberProfile { uid: string; name: string; email: string; addedByName: string; addedAtMs: number }
const toMember = (s: Snap): MemberProfile => ({ uid: s.id, name: str(s.data.name), email: str(s.data.email), addedByName: str(s.data.addedByName), addedAtMs: ms(s.data.addedAt) });
export const useMembers = (tripId: string) => useColl(`trips/${tripId}/members`, {}, toMember, tripId);

export const updateTripOverview = (id: string, patch: Record<string, unknown>) => be().patch(`trips/${id}`, { ...patch, updatedAt: now() });
export const setTripStatus = (id: string, status: TripStatus) => be().patch(`trips/${id}`, { status, updatedAt: now() });
export const setDipClassification = (id: string, value: string) => be().patch(`trips/${id}`, { dipClassification: value, updatedAt: now() });
export const setDipAgreed = (id: string, agreed: boolean, date: string) =>
  be().patch(`trips/${id}`, { dipAgreed: agreed, dipAgreedDate: agreed ? date : "", updatedAt: now() });

export async function updateTripRoles(tripId: string, roles: Partial<Record<TripRoleKey, RoleHolder>>) {
  const t = await be().get(`trips/${tripId}`);
  if (!t) throw new Error("Trip not found.");
  const resolved = await resolveRoles(roles);
  const memberUids = new Set<string>(t.data.memberUids as string[] ?? []);
  const pending = new Set<string>(t.data.pendingEmails as string[] ?? []);
  for (const h of Object.values(resolved)) {
    if (!h) continue;
    if (h.uid && !memberUids.has(h.uid)) { memberUids.add(h.uid); await be().set(`trips/${tripId}/members/${h.uid}`, { name: h.name, email: h.email, addedByName: "HOST", addedAt: now() }); }
    else if (!h.uid && h.email) pending.add(h.email);
  }
  await be().patch(`trips/${tripId}`, { roles: resolved, memberUids: [...memberUids], pendingEmails: [...pending], updatedAt: now() });
}

export async function addTripAccess(tripId: string, email: string, name: string): Promise<{ status: "added" | "pending" | "already" }> {
  const t = await be().get(`trips/${tripId}`);
  if (!t) throw new Error("Trip not found.");
  const me = toAccount(await be().get(accountPath()));
  const target = await accountByEmail(email);
  const members = t.data.memberUids as string[] ?? [];
  const pending = t.data.pendingEmails as string[] ?? [];
  if (target) {
    if (members.includes(target.uid)) return { status: "already" };
    await be().patch(`trips/${tripId}`, { memberUids: [...members, target.uid], pendingEmails: pending.filter((e) => e !== email) });
    await be().set(`trips/${tripId}/members/${target.uid}`, { name: name || target.name || email.split("@")[0], email, addedByName: me?.name ?? "", addedAt: now() });
    return { status: "added" };
  }
  if (pending.includes(email)) return { status: "already" };
  await be().patch(`trips/${tripId}`, { pendingEmails: [...pending, email] });
  return { status: "pending" };
}

export async function removeTripAccess(tripId: string, target: { uid?: string; email?: string }) {
  const t = await be().get(`trips/${tripId}`);
  if (!t) return;
  if (target.uid) {
    await be().patch(`trips/${tripId}`, { memberUids: (t.data.memberUids as string[] ?? []).filter((u) => u !== target.uid) });
    await be().del(`trips/${tripId}/members/${target.uid}`);
  } else if (target.email) {
    await be().patch(`trips/${tripId}`, { pendingEmails: (t.data.pendingEmails as string[] ?? []).filter((e) => e !== target.email) });
  }
}

// ---- Planning items ---------------------------------------------------------------------------

export interface Item { id: string; values: Record<string, unknown>; createdByName: string; updatedAtMs: number }
const toItem = (s: Snap): Item => {
  const { createdAt: _c, updatedAt, createdBy: _b, createdByName, ...values } = s.data;
  return { id: s.id, values, createdByName: str(createdByName), updatedAtMs: ms(updatedAt) };
};
export const useItems = (tripId: string, coll: string) => useColl(`trips/${tripId}/${coll}`, { orderBy: ["createdAt", "asc"] }, toItem, `${tripId}/${coll}`);
export const addItem = (s: Session, tripId: string, coll: string, values: Record<string, unknown>) =>
  be().set(`trips/${tripId}/${coll}/${be().newId()}`, { ...values, createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: now(), updatedAt: now() });
export const updateItem = (tripId: string, coll: string, id: string, values: Record<string, unknown>, keys: string[]) =>
  be().patch(`trips/${tripId}/${coll}/${id}`, { ...Object.fromEntries(keys.map((k) => [k, k in values ? values[k] : DELETE])), updatedAt: now() });
export const deleteItem = (tripId: string, coll: string, id: string) => be().del(`trips/${tripId}/${coll}/${id}`);

// ---- Messages ---------------------------------------------------------------------------------

const toMsg = (s: Snap): ChatMessage => ({
  id: s.id, senderUid: str(s.data.senderUid), senderName: str(s.data.senderName), text: str(s.data.text),
  createdAtMs: ms(s.data.createdAt) || now(), pending: s.pending,
});
export const useMessages = (tripId: string) => useColl(`trips/${tripId}/messages`, { orderBy: ["createdAt", "asc"] }, toMsg, tripId);
export const sendMessage = (s: Session, tripId: string, text: string) =>
  be().set(`trips/${tripId}/messages/${be().newId()}`, { senderUid: s.uid, senderName: s.name.slice(0, 80), text, createdAt: now() });
export const deleteMessage = (tripId: string, id: string) => be().del(`trips/${tripId}/messages/${id}`);

export function useReadAt(uid: string, tripId: string): number | null {
  return useDocOf(`users/${uid}/tripReads/${tripId}`, (d) => ms(d?.data.readAt)) ?? null;
}
const lastMark = new Map<string, number>();
export async function markRead(uid: string, tripId: string) {
  // One write per few seconds at most (the store asks for writes only on real change).
  const k = `${uid}/${tripId}`;
  if (now() - (lastMark.get(k) ?? 0) < 3000) return;
  lastMark.set(k, now());
  await be().set(`users/${uid}/tripReads/${tripId}`, { readAt: now() });
}

// ---- Attachments ------------------------------------------------------------------------------

export interface Attachment { id: string; name: string; path: string; size: number; contentType: string; uploadedByName: string; uploadedBy: string; createdAtMs: number }
const toAtt = (s: Snap): Attachment => ({
  id: s.id, name: str(s.data.name), path: str(s.data.path), size: Number(s.data.size) || 0, contentType: str(s.data.contentType),
  uploadedBy: str(s.data.uploadedBy), uploadedByName: str(s.data.uploadedByName), createdAtMs: ms(s.data.createdAt),
});
export const useAttachments = (tripId: string) => useColl(`trips/${tripId}/attachments`, { orderBy: ["createdAt", "desc"] }, toAtt, tripId);

export async function uploadAttachment(s: Session, tripId: string, file: File, onProgress: (pct: number) => void) {
  if (file.size > Math.min(MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024)) throw new Error("That file is larger than 20 MB.");
  const assets = be().assets;
  if (!assets) throw new Error("File uploads aren't available for you on this demo.");
  onProgress(10);
  const { id, url } = await assets.upload(file);
  onProgress(100);
  await be().set(`trips/${tripId}/attachments/${be().newId()}`, {
    name: file.name.slice(0, 200), path: `${id} ${url}`, size: file.size, contentType: (file.type || "application/octet-stream").slice(0, 120),
    uploadedBy: s.uid, uploadedByName: s.name.slice(0, 80), createdAt: now(),
  });
}

// The demo keeps "<assetId> <url>" in `path`: the id to delete it, the url exactly as the upload gave it.
const assetOf = (a: Attachment) => { const [id, ...rest] = a.path.split(" "); return { id, url: rest.join(" ") }; };
export const attachmentUrl = async (a: Attachment) => assetOf(a).url;

export async function openAttachment(a: Attachment) {
  const downloads = be().downloads;
  if (!downloads) throw new Error("Downloads aren't available here.");
  const res = await fetch(assetOf(a).url);
  if (!res.ok) throw new Error("That file couldn't be fetched.");
  await downloads.save({ filename: a.name, data: await res.blob() });
}

export async function deleteAttachment(tripId: string, a: Attachment) {
  await be().assets?.delete(assetOf(a).id).catch(() => undefined);
  await be().del(`trips/${tripId}/attachments/${a.id}`);
}

// ---- Requests to the Team Leader --------------------------------------------------------------

const toTl = (s: Snap): TlRequest => {
  const v = s.data;
  const st = ["pending", "approved", "rejected", "completed"].includes(v.status as string) ? v.status : "pending";
  return {
    id: s.id, kind: (REQUEST_KINDS.some((k) => k.key === v.kind) ? v.kind : "resource") as RequestKind,
    title: str(v.title), details: str(v.details), quantity: num(v.quantity), amount: num(v.amount), currency: str(v.currency),
    neededBy: str(v.neededBy), createdBy: str(v.createdBy), createdByName: str(v.createdByName), createdAtMs: ms(v.createdAt),
    status: st as TlRequestStatus, decidedByName: str(v.decidedByName), decidedAtMs: ms(v.decidedAt), decisionNote: str(v.decisionNote),
    completedByName: str(v.completedByName), completedAtMs: ms(v.completedAt), response: str(v.response),
  };
};
export const useTlRequests = (tripId: string) => useColl(`trips/${tripId}/tlRequests`, {}, toTl, tripId);

export interface TlRequestInput { kind: RequestKind; title: string; details: string; quantity: number | null; amount: number | null; currency: string; neededBy: string }
export const addTlRequest = (s: Session, tripId: string, r: TlRequestInput) =>
  be().set(`trips/${tripId}/tlRequests/${be().newId()}`, {
    kind: r.kind, title: r.title.trim(), details: r.details.trim(),
    ...(r.quantity !== null ? { quantity: r.quantity } : {}),
    ...(r.amount !== null ? { amount: r.amount, currency: r.currency } : {}),
    ...(r.neededBy ? { neededBy: r.neededBy } : {}),
    createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: now(), status: "pending",
  });
export const decideTlRequest = (s: Session, tripId: string, id: string, approve: boolean, note: string) =>
  be().patch(`trips/${tripId}/tlRequests/${id}`, { status: approve ? "approved" : "rejected", decidedBy: s.uid, decidedByName: s.name.slice(0, 80), decidedAt: now(), decisionNote: note.trim().slice(0, 1000) });
export const completeTlRequest = (s: Session, tripId: string, id: string, response: string) =>
  be().patch(`trips/${tripId}/tlRequests/${id}`, { status: "completed", completedBy: s.uid, completedByName: s.name.slice(0, 80), completedAt: now(), response: response.trim().slice(0, 1000) });
export const resubmitTlRequest = (tripId: string, id: string) =>
  be().patch(`trips/${tripId}/tlRequests/${id}`, { status: "pending", decidedBy: DELETE, decidedByName: DELETE, decidedAt: DELETE, decisionNote: DELETE });
export const deleteTlRequest = (tripId: string, id: string) => be().del(`trips/${tripId}/tlRequests/${id}`);

// ---- Vaccinations -----------------------------------------------------------------------------

const toVacc = (s: Snap): VaccinationDeclaration => ({
  uid: s.id, name: str(s.data.name), notes: str(s.data.notes), declared: s.data.declared === true, declaredAtMs: ms(s.data.declaredAt),
  vaccines: Array.isArray(s.data.vaccines) ? (s.data.vaccines as Record<string, unknown>[]).map((x) => ({ name: str(x?.name), date: str(x?.date) })) : [],
});
export function useVaccinations(tripId: string, uid: string, all: boolean): VaccinationDeclaration[] | null {
  const list = useColl(`trips/${tripId}/vaccinations`, {}, toVacc, tripId);
  return list ? (all ? list : list.filter((v) => v.uid === uid)) : null;
}
export const saveVaccination = (s: Session, tripId: string, vaccines: VaccineRecord[], notes: string, declared: boolean) =>
  be().set(`trips/${tripId}/vaccinations/${s.uid}`, {
    name: s.name.slice(0, 80), vaccines, notes: notes.trim().slice(0, 2000), declared, ...(declared ? { declaredAt: now() } : {}), updatedAt: now(),
  });

// ---- Debrief ----------------------------------------------------------------------------------

const toDebrief = (d: Snap | null): Debrief => d ? {
  wentWell: str(d.data.wentWell), couldBeBetter: str(d.data.couldBeBetter), welfareConcerns: str(d.data.welfareConcerns),
  injuryRefs: Array.isArray(d.data.injuryRefs) ? (d.data.injuryRefs as unknown[]).map(String) : [], reciprocityIssues: d.data.reciprocityIssues === true,
  reciprocityDescription: str(d.data.reciprocityDescription), updatedBy: str(d.data.updatedByName), updatedAtMs: ms(d.data.updatedAt),
} : EMPTY_DEBRIEF;
export const useDebrief = (tripId: string): Debrief | null => useDocOf(`trips/${tripId}/debrief/current`, toDebrief) ?? null;
export const saveDebrief = (s: Session, tripId: string, d: Omit<Debrief, "updatedBy" | "updatedAtMs">) =>
  be().set(`trips/${tripId}/debrief/current`, { ...d, updatedByUid: s.uid, updatedByName: s.name.slice(0, 80), updatedAt: now() });

// ---- Finance ----------------------------------------------------------------------------------

const toFin = (s: Snap): FinanceEntry => ({
  id: s.id, ownerUid: str(s.data.ownerUid), ownerName: str(s.data.ownerName), date: str(s.data.date), category: str(s.data.category),
  description: str(s.data.description), amount: Number(s.data.amount) || 0, currency: str(s.data.currency) || "GBP",
  paymentMethod: str(s.data.paymentMethod), receiptRef: str(s.data.receiptRef), updatedAtMs: ms(s.data.updatedAt),
});
export const useFinanceEntries = (tripId: string) => useColl(`trips/${tripId}/financeEntries`, {}, toFin, tripId);
export const saveFinanceEntry = (s: Session, tripId: string, id: string | null, e: Omit<FinanceEntry, "id" | "ownerUid" | "ownerName" | "updatedAtMs">) =>
  be().set(`trips/${tripId}/financeEntries/${id ?? be().newId()}`, { ...e, ownerUid: s.uid, ownerName: s.name.slice(0, 80), updatedAt: now() });
export const deleteFinanceEntry = (tripId: string, id: string) => be().del(`trips/${tripId}/financeEntries/${id}`);

export function useFinanceNotes(tripId: string): Record<string, { name: string; text: string; updatedAtMs: number }> | null {
  const list = useColl(`trips/${tripId}/financeNotes`, {}, (s) => [s.id, { name: str(s.data.name), text: str(s.data.text), updatedAtMs: ms(s.data.updatedAt) }] as const, tripId);
  return list ? Object.fromEntries(list) : null;
}
export const saveFinanceNote = (s: Session, tripId: string, text: string) =>
  be().set(`trips/${tripId}/financeNotes/${s.uid}`, { name: s.name.slice(0, 80), text: text.trim(), updatedAt: now() });

// ---- HOST administration ------------------------------------------------------------------------

export async function setHostRole(email: string, host: boolean) {
  const hits = await be().list("accounts", { where: [["email", "==", email.toLowerCase()]] });
  if (hits.length === 0) throw new Error("No account with that email.");
  for (const h of hits) await be().patch(`accounts/${h.id}`, { host });
  return { uid: hits[0].id };
}

// ---- PDF snapshot -----------------------------------------------------------------------------

export interface TripSnapshot {
  trip: Trip; members: MemberProfile[]; items: Record<string, Item[]>; messages: ChatMessage[]; attachments: Attachment[];
  tlRequests: TlRequest[]; vaccinations: VaccinationDeclaration[]; debrief: Debrief; finance: FinanceEntry[];
  financeNotes: Record<string, { name: string; text: string }>;
}

export async function loadTripSnapshot(tripId: string): Promise<TripSnapshot> {
  const t = await be().get(`trips/${tripId}`);
  if (!t) throw new Error("Trip not found.");
  const sub = (n: string) => be().list(`trips/${tripId}/${n}`);
  const [members, flights, hotels, cars, assets, messages, attachments, tl, vacc, debrief, fin, notes] = await Promise.all([
    sub("members"), sub("flights"), sub("hotels"), sub("cars"), sub("assets"), sub("messages"), sub("attachments"), sub("tlRequests"),
    sub("vaccinations"), be().get(`trips/${tripId}/debrief/current`), sub("financeEntries"), sub("financeNotes"),
  ]);
  const me = await be().get(accountPath());
  const trip = toTrip(t);
  const lead = me?.data.host === true || trip.roles.teamLeader?.uid === be().uid;
  return {
    trip, members: members.map(toMember),
    items: { flights: flights.map(toItem), hotels: hotels.map(toItem), cars: cars.map(toItem), assets: assets.map(toItem) },
    messages: messages.map(toMsg).sort((a, b) => a.createdAtMs - b.createdAtMs),
    attachments: attachments.map(toAtt), tlRequests: tl.map(toTl),
    vaccinations: vacc.map(toVacc).filter((v) => lead || v.uid === be().uid),
    debrief: toDebrief(debrief), finance: fin.map(toFin),
    financeNotes: Object.fromEntries(notes.map((n) => [n.id, { name: str(n.data.name), text: str(n.data.text) }])),
  };
}

/** Not used by the demo screens; kept so imports match ../store.ts. */
export const call = async () => { throw new Error("Not available in the demo."); };
