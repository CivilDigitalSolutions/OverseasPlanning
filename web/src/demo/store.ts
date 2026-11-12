/**
 * DEMO store — same exports as ../store.ts, backed by demo/backend.ts instead of Firebase.
 * The work the Cloud Functions do in production (createTrip, access, agreements, HOST role) is
 * done here in the page. There are no security rules in the demo: it is for trying the screens.
 */
import { useEffect, useState } from "react";
import {
  liveTrips, todayIso,
  EMPTY_DEBRIEF, MAX_ATTACHMENT_BYTES, PRIVACY_VERSION, REQUEST_KINDS, TERMS_VERSION,
  type ChatMessage, type Contact, type ContactInput, type TripContact, type Debrief, type FinanceEntry, type RequestInput, type RequestKind, type RoleHolder, type TlRequest,
  toRequestStatus, type Trip, type TripRequest, type TripRoleKey, type TripStatus, type VaccinationDeclaration, type VaccineRecord,
  type Team, cleanTeamName, sortTeams, pendingLabel,
} from "../model";
import { DELETE, be, type QuerySpec, type Snap } from "./backend";
import { computeAccess, flightLabel, type AccessInput, type Person } from "../membership";

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

export interface Session { uid: string; email: string; name: string; emailVerified: boolean; isHost: boolean; isAdmin: boolean; isController: boolean; isSpcProfile: boolean }
export interface Account { name: string; email: string; emailVerified: boolean; host: boolean; controller: boolean; spc: boolean; admin: boolean; passkeys: { id: string; label: string; createdAtMs: number; lastUsedAtMs: number }[] }

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
  name: str(s.data.name), email: str(s.data.email), emailVerified: s.data.emailVerified === true, host: s.data.host === true, controller: s.data.controller === true, spc: s.data.spc === true, admin: s.data.admin === true,
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
    isHost: account.host, isAdmin: account.admin, isController: account.controller, isSpcProfile: account.spc,
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
    for (const r of Object.values(roles)) if ((r?.email ?? "").toLowerCase() === me.email) r.uid = be().uid;
    const extraEmails = (t.data.extraAccessEmails as string[] | undefined) ?? [];
    const patch: Record<string, unknown> = { roles };
    if (extraEmails.includes(me.email)) {
      patch.extraAccessEmails = extraEmails.filter((e) => e !== me.email);
      patch.extraAccessUids = [...new Set([...((t.data.extraAccessUids as string[] | undefined) ?? []), be().uid])];
    }
    await be().patch(`trips/${t.id}`, patch);
    await recomputeAccess(t.id);
  }
  return { added: trips.length };
}

// ---- Directory + membership (production: functions/src/lib/membership.ts) ----------------------

/** `spc`: holds the SPC role profile (offered by the trip SPC picker). */
export interface DirectoryPerson { uid: string; name: string; email: string; spc?: boolean }
/** The in-app directory: everyone signed up with a confirmed email (demo: the demo accounts). */
export function useDirectory(): DirectoryPerson[] | null {
  const list = useColl("accounts", {}, (s) => ({ uid: s.id, name: str(s.data.name), email: str(s.data.email), ok: s.data.emailVerified === true, spc: s.data.spc === true }));
  return list ? list.filter((p) => p.ok && p.name).map(({ uid, name, email, spc }) => ({ uid, name, email, spc })) : null;
}
export const upsertDirectory = async (_s: Session) => undefined; // demo: accounts are the directory

// ---- Teams (owner, 2026-11-12). The demo starts with a few sample teams so the dropdown has options.
const SAMPLE_TEAMS = ["T101", "T102", "T103", "T104", "T105"];
let teamsSeeded = false;
export function useTeams(): Team[] | null {
  const list = useColl("teams", {}, (s) => ({ id: s.id, name: str(s.data.name) || s.id }));
  useEffect(() => {
    if (list && list.length === 0 && !teamsSeeded) {
      teamsSeeded = true;
      void be().get("meta/teamsSeeded").then((d) => d ? undefined : Promise.all([
        be().set("meta/teamsSeeded", { at: now() }), ...SAMPLE_TEAMS.map((n) => be().set(`teams/${n}`, { name: n })),
      ]));
    }
  }, [list]);
  return list ? sortTeams(list) : null;
}
export const addTeam = (s: Session, name: string) => be().set(`teams/${cleanTeamName(name)}`, { name: cleanTeamName(name), createdBy: s.uid, createdAt: now() });
export async function renameTeam(s: Session, team: Team, name: string) {
  await addTeam(s, name);
  if (cleanTeamName(name) !== team.id) await be().del(`teams/${team.id}`);
}
export const deleteTeam = (id: string) => be().del(`teams/${id}`);

/** Recompute who is part of a trip from requester, roles, flight passengers and additional access. */
export async function recomputeAccess(tripId: string, skipNotify: string[] = []) {
  const t = await be().get(`trips/${tripId}`);
  if (!t) return null;
  const [flights, memberDocs] = await Promise.all([be().list(`trips/${tripId}/flights`), be().list(`trips/${tripId}/members`)]);
  const known = new Map(memberDocs.map((d) => [d.id, { name: str(d.data.name), email: str(d.data.email), addedAt: d.data.addedAt }]));
  let requesterUid = str(t.data.requesterUid);
  let requester: Person | null = null;
  const reqId = str(t.data.requestId);
  const r = reqId ? await be().get(`tripRequests/${reqId}`) : null;
  if (r) { requesterUid ||= str(r.data.requesterUid); requester = { uid: requesterUid, name: str(r.data.requesterName), email: str(r.data.requesterEmail) }; }
  const roles = (t.data.roles ?? {}) as AccessInput["roles"];
  const passengers: AccessInput["passengers"] = [];
  for (const f of flights) {
    for (const p of (f.data.passengers ?? []) as Record<string, unknown>[]) {
      if (p && typeof p.uid === "string" && p.uid) passengers.push({ flight: flightLabel(f.data), name: str(p.name), uid: p.uid, email: str(p.email) });
    }
  }
  const explained = new Set([requesterUid, ...Object.values(roles).map((x) => x?.uid ?? ""), ...passengers.map((p) => p.uid ?? "")]);
  const roleEmails = new Set(Object.values(roles).map((x) => (x?.email ?? "").toLowerCase()).filter(Boolean));
  const extraUidList: string[] = Array.isArray(t.data.extraAccessUids) ? t.data.extraAccessUids as string[]
    : ((t.data.memberUids ?? []) as string[]).filter((u) => !explained.has(u));
  const extraEmails: string[] = Array.isArray(t.data.extraAccessEmails) ? t.data.extraAccessEmails as string[]
    : ((t.data.pendingEmails ?? []) as string[]).filter((e) => !roleEmails.has(e.toLowerCase()));
  const extraUids: Person[] = [];
  for (const uid of extraUidList) {
    let p = known.get(uid) as { name: string; email: string } | undefined;
    if (!p?.name) { const a = await be().get(`accounts/${uid}`); if (a) p = { name: str(a.data.name), email: str(a.data.email) }; }
    extraUids.push({ uid, name: p?.name ?? "", email: p?.email ?? "" });
  }
  const result = computeAccess({ requester, roles, passengers, extraUids, extraEmails });
  await be().patch(`trips/${tripId}`, {
    memberUids: result.memberUids, pendingEmails: result.pendingEmails, extraAccessUids: extraUidList, extraAccessEmails: extraEmails,
    ...(requesterUid ? { requesterUid } : {}),
  });
  for (const [uid, m] of Object.entries(result.members)) {
    await be().set(`trips/${tripId}/members/${uid}`, { name: m.name, email: m.email, reasons: m.reasons, addedAt: known.get(uid)?.addedAt ?? now() });
  }
  for (const d of memberDocs) if (!result.members[d.id]) await be().del(`trips/${tripId}/members/${d.id}`);
  const before = new Set((t.data.memberUids ?? []) as string[]);
  const added = result.memberUids.filter((u) => !before.has(u) && !skipNotify.includes(u));
  if (added.length) await notifyDemo(added, {
    type: "trip_added", title: "Added to a trip", body: `You've been added to ${str(t.data.name) || "a trip"} (${str(t.data.location)}).`,
    tripId, link: `/trips/${tripId}`,
  });
  return result;
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
    requestId: input.requestId, requesterUid: str(req.data.requesterUid), extraAccessUids: [], extraAccessEmails: [], createdBy: be().uid, createdByName: me?.name ?? "", createdByEmail: me?.email ?? "",
    createdAt: now(), updatedAt: now(),
  });
  await be().patch(`tripRequests/${input.requestId}`, { status: "accepted", tripId, decidedAt: now() });
  await recomputeAccess(tripId);
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
    updatedByName: str(v.updatedByName), updatedAtMs: ms(v.updatedAt),
    createdAtMs: ms(v.createdAt), pendingRequests: Number(v.pendingRequests) || 0, pendingFlights: Number(v.pendingFlights) || 0,
  };
};

export const useTrips = (s: Session) =>
  useColl("trips", s.isHost ? {} : { where: [["memberUids", "array-contains", s.uid]] }, toTrip, `${s.uid}${s.isHost}`);

export const useTrip = (id: string) => useDocOf(`trips/${id}`, (d) => (d ? toTrip(d) : null));

export interface MemberProfile { uid: string; name: string; email: string; reasons: string[]; addedByName: string; addedAtMs: number }
const toMember = (s: Snap): MemberProfile => ({
  uid: s.id, name: str(s.data.name), email: str(s.data.email), reasons: Array.isArray(s.data.reasons) ? (s.data.reasons as unknown[]).map(String) : [],
  addedByName: str(s.data.addedByName), addedAtMs: ms(s.data.addedAt),
});
export const useMembers = (tripId: string) => useColl(`trips/${tripId}/members`, {}, toMember, tripId);

async function editStamp() {
  const me = toAccount(await be().get(accountPath()));
  return { updatedAt: now(), updatedBy: be().uid, updatedByName: (me?.name || me?.email || "").slice(0, 80) };
}
export const updateTripOverview = async (id: string, patch: Record<string, unknown>) => be().patch(`trips/${id}`, { ...patch, ...(await editStamp()) });
export const setTripStatus = async (id: string, status: TripStatus) => be().patch(`trips/${id}`, { status, ...(await editStamp()) });
export const setDipClassification = async (id: string, value: string) => be().patch(`trips/${id}`, { dipClassification: value, ...(await editStamp()) });
export const setDipAgreed = async (id: string, agreed: boolean, date: string) =>
  be().patch(`trips/${id}`, { dipAgreed: agreed, dipAgreedDate: agreed ? date : "", ...(await editStamp()) });

export async function updateTripRoles(tripId: string, roles: Partial<Record<TripRoleKey, RoleHolder>>) {
  const t = await be().get(`trips/${tripId}`);
  if (!t) throw new Error("Trip not found.");
  await be().patch(`trips/${tripId}`, { roles: await resolveRoles(roles), ...(await editStamp()) });
  await recomputeAccess(tripId);
}

export async function addTripAccess(tripId: string, target: { uid?: string; email?: string }): Promise<{ status: "added" | "pending" | "already" }> {
  const t = await be().get(`trips/${tripId}`);
  if (!t) throw new Error("Trip not found.");
  const members = (t.data.memberUids as string[]) ?? [];
  const extraUids = (t.data.extraAccessUids as string[] | undefined) ?? [];
  const extraEmails = (t.data.extraAccessEmails as string[] | undefined) ?? [];
  const email = (target.email ?? "").trim().toLowerCase();
  const uid = target.uid ?? (email ? (await accountByEmail(email))?.uid : undefined);
  if (uid) {
    if (members.includes(uid)) return { status: "already" };
    await be().patch(`trips/${tripId}`, { extraAccessUids: [...extraUids, uid], extraAccessEmails: extraEmails.filter((e) => e !== email) });
    await recomputeAccess(tripId);
    return { status: "added" };
  }
  if (((t.data.pendingEmails as string[]) ?? []).includes(email)) return { status: "already" };
  await be().patch(`trips/${tripId}`, { extraAccessEmails: [...extraEmails, email] });
  await recomputeAccess(tripId);
  return { status: "pending" };
}

export async function removeTripAccess(tripId: string, target: { uid?: string; email?: string }): Promise<{ stillOnTripAs: string[] }> {
  const t = await be().get(`trips/${tripId}`);
  if (!t) return { stillOnTripAs: [] };
  if (target.uid) await be().patch(`trips/${tripId}`, { extraAccessUids: ((t.data.extraAccessUids as string[] | undefined) ?? (t.data.memberUids as string[]) ?? []).filter((u) => u !== target.uid) });
  else if (target.email) await be().patch(`trips/${tripId}`, { extraAccessEmails: ((t.data.extraAccessEmails as string[] | undefined) ?? []).filter((e) => e !== target.email) });
  const r = await recomputeAccess(tripId);
  return { stillOnTripAs: target.uid ? r?.members[target.uid]?.reasons ?? [] : [] };
}

// ---- Planning items ---------------------------------------------------------------------------

export interface Item { id: string; values: Record<string, unknown>; createdByName: string; updatedAtMs: number }
const toItem = (s: Snap): Item => {
  const { createdAt: _c, updatedAt, createdBy: _b, updatedBy: _u, createdByName, ...values } = s.data;
  return { id: s.id, values, createdByName: str(createdByName), updatedAtMs: ms(updatedAt) };
};
export const useItems = (tripId: string, coll: string) => useColl(`trips/${tripId}/${coll}`, { orderBy: ["createdAt", "asc"] }, toItem, `${tripId}/${coll}`);
const passengerUids = (v: Record<string, unknown> | undefined) => new Set(((v?.passengers ?? []) as { uid?: string }[]).map((p) => p?.uid ?? "").filter(Boolean));
async function afterFlights(tripId: string, coll: string, before?: Set<string>, id?: string) {
  if (coll !== "flights") return;
  const after = id ? passengerUids((await be().get(`trips/${tripId}/flights/${id}`))?.data) : new Set<string>();
  const booked = [...after].filter((u) => !(before ?? new Set()).has(u));
  await recomputeAccess(tripId, booked);
  if (booked.length && id) {
    const f = (await be().get(`trips/${tripId}/flights/${id}`))!.data;
    const t = await be().get(`trips/${tripId}`);
    await notifyDemo(booked, {
      type: "flight_added", title: "Booked on a flight",
      body: `${flightLabel(f)} ${[f.from, f.to].filter(Boolean).join(" → ")}${f.departAt ? `, ${String(f.departAt).replace("T", " ")}` : ""} — ${str(t?.data.name) || "your trip"}.`,
      tripId, link: `/trips/${tripId}/flights`,
    });
  }
}
export async function addItem(s: Session, tripId: string, coll: string, values: Record<string, unknown>) {
  const id = be().newId();
  await be().set(`trips/${tripId}/${coll}/${id}`, { ...values, createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: now(), updatedAt: now(), updatedBy: s.uid });
  await afterFlights(tripId, coll, new Set(), id);
  if (coll === "flights") { await recountSpc(tripId); await tellSpc(tripId, `Flight to approve: ${flightLabel(values)}`, "flights"); }
}
export async function updateItem(tripId: string, coll: string, id: string, values: Record<string, unknown>, keys: string[]) {
  const old = coll === "flights" ? (await be().get(`trips/${tripId}/${coll}/${id}`))?.data : undefined;
  const before = coll === "flights" ? passengerUids(old) : undefined;
  await be().patch(`trips/${tripId}/${coll}/${id}`, { ...Object.fromEntries(keys.map((k) => [k, k in values ? values[k] : DELETE])), updatedAt: now(), updatedBy: be().uid });
  await afterFlights(tripId, coll, before, id);
  if (coll === "flights") {
    await recountSpc(tripId);
    // Editing a decided flight clears the decision, so it needs the SPC again.
    if (old?.spcDecision) await tellSpc(tripId, `Changed flight to approve again: ${flightLabel(values)}`, "flights");
  }
}
export const deleteItem = (tripId: string, coll: string, id: string) => be().del(`trips/${tripId}/${coll}/${id}`)
  .then(() => afterFlights(tripId, coll)).then(() => (coll === "flights" ? recountSpc(tripId) : undefined));


export const decideFlight = (s: Session, tripId: string, id: string, decision: "approved" | "not_approved", rationale: string) =>
  be().patch(`trips/${tripId}/flights/${id}`, {
    spcDecision: decision, spcRationale: rationale.trim().slice(0, 2000), spcDecidedBy: s.uid, spcDecidedByName: s.name.slice(0, 80), spcDecidedAt: now(), updatedAt: now(),
  }).then(() => recountSpc(tripId));

// ---- Messages ---------------------------------------------------------------------------------

const toMsg = (s: Snap): ChatMessage => ({
  id: s.id, senderUid: str(s.data.senderUid), senderName: str(s.data.senderName), text: str(s.data.text),
  createdAtMs: ms(s.data.createdAt) || now(), pending: s.pending,
});
export const useMessages = (tripId: string) => useColl(`trips/${tripId}/messages`, { orderBy: ["createdAt", "asc"] }, toMsg, tripId);
export async function sendMessage(s: Session, tripId: string, text: string) {
  await be().set(`trips/${tripId}/messages/${be().newId()}`, { senderUid: s.uid, senderName: s.name.slice(0, 80), text, createdAt: now() });
  const t = await be().get(`trips/${tripId}`);
  await notifyDemo((t?.data.memberUids ?? []) as string[], {
    type: "message", title: `${s.name || "New message"} · ${str(t?.data.name) || "Trip"}`, body: text.length > 140 ? `${text.slice(0, 137)}…` : text,
    tripId, link: `/trips/${tripId}/messages`,
  });
}
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
  return {
    id: s.id, kind: (REQUEST_KINDS.some((k) => k.key === v.kind) ? v.kind : "resource") as RequestKind,
    title: str(v.title), details: str(v.details), quantity: num(v.quantity), amount: num(v.amount), currency: str(v.currency),
    neededBy: str(v.neededBy), createdBy: str(v.createdBy), createdByName: str(v.createdByName), createdAtMs: ms(v.createdAt),
    status: toRequestStatus(v.status), decidedByName: str(v.decidedByName), decidedAtMs: ms(v.decidedAt), decisionNote: str(v.decisionNote),
  };
};
export const useTlRequests = (tripId: string) => useColl(`trips/${tripId}/tlRequests`, {}, toTl, tripId);

export interface TlRequestInput { kind: RequestKind; title: string; details: string; quantity: number | null; amount: number | null; currency: string; neededBy: string }
export async function addTlRequest(s: Session, tripId: string, r: TlRequestInput) {
  await be().set(`trips/${tripId}/tlRequests/${be().newId()}`, {
    kind: r.kind, title: r.title.trim(), details: r.details.trim(),
    ...(r.quantity !== null ? { quantity: r.quantity } : {}),
    ...(r.amount !== null ? { amount: r.amount, currency: r.currency } : {}),
    ...(r.neededBy ? { neededBy: r.neededBy } : {}),
    createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: now(), status: "pending",
  });
  await recountSpc(tripId);
  await tellSpc(tripId, `Request to approve: ${r.title.trim()}`, "requests");
}
export const decideTlRequest = (s: Session, tripId: string, id: string, approve: boolean, note: string) =>
  be().patch(`trips/${tripId}/tlRequests/${id}`, { status: approve ? "approved" : "rejected", decidedBy: s.uid, decidedByName: s.name.slice(0, 80), decidedAt: now(), decisionNote: note.trim().slice(0, 1000) })
    .then(() => recountSpc(tripId));
export async function resubmitTlRequest(tripId: string, id: string) {
  await be().patch(`trips/${tripId}/tlRequests/${id}`, { status: "pending", decidedBy: DELETE, decidedByName: DELETE, decidedAt: DELETE, decisionNote: DELETE });
  await recountSpc(tripId);
  await tellSpc(tripId, `Request resubmitted: ${str((await be().get(`trips/${tripId}/tlRequests/${id}`))?.data.title)}`, "requests");
}
export const deleteTlRequest = (tripId: string, id: string) => be().del(`trips/${tripId}/tlRequests/${id}`).then(() => recountSpc(tripId));

// ---- SPC outstanding work (owner, 2026-11-12): counts on the trip + notifications to its SPCs ------
/** What the functions do in production: count what waits for an SPC and store it on the trip. */
async function recountSpc(tripId: string) {
  const [reqs, flights] = await Promise.all([be().list(`trips/${tripId}/tlRequests`), be().list(`trips/${tripId}/flights`)]);
  await be().patch(`trips/${tripId}`, {
    pendingRequests: reqs.filter((r) => toRequestStatus(r.data.status) === "pending").length,
    pendingFlights: flights.filter((f) => !f.data.spcDecision).length,
  });
}
/** The trip's named SPC plus SPC-profile holders on the trip. */
async function spcsOf(tripId: string): Promise<string[]> {
  const t = (await be().get(`trips/${tripId}`))?.data;
  if (!t) return [];
  const named = str((t.roles as Record<string, { uid?: string }> | undefined)?.spc?.uid);
  const members = (t.memberUids ?? []) as string[];
  const profiles = (await be().list("accounts")).filter((a) => a.data.spc === true && members.includes(a.id)).map((a) => a.id);
  return [...new Set([named, ...profiles].filter(Boolean))];
}
async function tellSpc(tripId: string, body: string, tab: "requests" | "flights") {
  const t = (await be().get(`trips/${tripId}`))?.data;
  await notifyDemo(await spcsOf(tripId), { type: "spc_pending", title: "Awaiting your approval", body: `${body} — ${str(t?.name)}`, tripId, link: `/trips/${tripId}/${tab}` });
}
export async function remindSpc(_s: Session, tripId: string): Promise<{ notified: number }> {
  await recountSpc(tripId);
  const t = (await be().get(`trips/${tripId}`))!;
  const spcs = (await spcsOf(tripId)).filter((u) => u !== be().uid);
  await notifyDemo(spcs, { type: "spc_pending", title: "Reminder: awaiting your approval", body: `${pendingLabel(toTrip(t))} — ${str(t.data.name)}`, tripId, link: `/trips/${tripId}/requests` });
  return { notified: spcs.length };
}

// ---- Request summaries (Team Leader / SPC) --------------------------------------------------------

export type SummaryRole = "teamLeader" | "spc";
export interface Summary { text: string; byName: string; updatedAtMs: number }
export function useSummaries(tripId: string): Record<SummaryRole, Summary | null> | null {
  const list = useColl(`trips/${tripId}/summaries`, {}, (s) => [s.id, { text: str(s.data.text), byName: str(s.data.byName), updatedAtMs: ms(s.data.updatedAt) }] as const, tripId);
  if (!list) return null;
  const m = Object.fromEntries(list) as Record<string, Summary>;
  return { teamLeader: m.teamLeader ?? null, spc: m.spc ?? null };
}
export const saveSummary = (s: Session, tripId: string, role: SummaryRole, text: string) =>
  be().set(`trips/${tripId}/summaries/${role}`, { text: text.trim().slice(0, 5000), byUid: s.uid, byName: s.name.slice(0, 80), updatedAt: now() });

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


// ---- Contacts book ------------------------------------------------------------------------------

const toContact = (s: Snap): Contact => ({
  id: s.id, name: str(s.data.name), organisation: str(s.data.organisation), jobTitle: str(s.data.jobTitle), email: str(s.data.email), phone: str(s.data.phone),
  country: str(s.data.country), notes: str(s.data.notes), createdBy: str(s.data.createdBy), createdByName: str(s.data.createdByName), updatedAtMs: ms(s.data.updatedAt),
});
export const useContacts = () => useColl("contacts", {}, toContact);
export async function saveContact(s: Session, id: string | null, c: ContactInput): Promise<string> {
  if (id) { await be().patch(`contacts/${id}`, { ...c, updatedAt: now() }); return id; }
  const nid = be().newId();
  await be().set(`contacts/${nid}`, { ...c, createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: now(), updatedAt: now() });
  return nid;
}
export const deleteContact = (id: string) => be().del(`contacts/${id}`);
const toTripContact = (s: Snap): TripContact => ({
  id: s.id, name: str(s.data.name), organisation: str(s.data.organisation), jobTitle: str(s.data.jobTitle), email: str(s.data.email), phone: str(s.data.phone),
  country: str(s.data.country), tripRole: str(s.data.tripRole), addedByName: str(s.data.addedByName), addedAtMs: ms(s.data.addedAt),
});
export const useTripContacts = (tripId: string) => useColl(`trips/${tripId}/contacts`, {}, toTripContact, tripId);
export async function addContactToTrip(s: Session, tripId: string, c: Contact, tripRole: string) {
  await be().set(`trips/${tripId}/contacts/${c.id}`, {
    name: c.name, organisation: c.organisation, jobTitle: c.jobTitle, email: c.email, phone: c.phone, country: c.country,
    tripRole: tripRole.trim().slice(0, 80), addedBy: s.uid, addedByName: s.name.slice(0, 80), addedAt: now(),
  });
  await be().set(`users/${s.uid}/recentContacts/${c.id}`, { usedAt: now() });
}
export function useRecentContactIds(s: Session): string[] | null {
  const list = useColl(`users/${s.uid}/recentContacts`, {}, (d) => ({ id: d.id, at: Number(d.data.usedAt) || 0 }));
  return list ? [...list].sort((a, b) => b.at - a.at).slice(0, 5).map((x) => x.id) : null;
}
export const removeTripContact = (tripId: string, id: string) => be().del(`trips/${tripId}/contacts/${id}`);

// ---- HOST administration ------------------------------------------------------------------------

export async function setRole(email: string, role: "host" | "controller", on: boolean) {
  const hits = await be().list("accounts", { where: [["email", "==", email.toLowerCase()]] });
  if (hits.length === 0) throw new Error("No account with that email.");
  for (const h of hits) await be().patch(`accounts/${h.id}`, { [role]: on });
  return { uid: hits[0].id };
}

/** Controllers: every live trip, basic details only (production: listLiveTrips callable). */
export function useControllerLiveTrips(s: Session): Trip[] | null {
  const all = useColl(s.isController ? "trips" : null, {}, toTrip, String(s.isController));
  return s.isController ? (all ? liveTrips(all, todayIso()) : null) : [];
}

// ---- PDF snapshot -----------------------------------------------------------------------------

export interface TripSnapshot {
  trip: Trip; members: MemberProfile[]; items: Record<string, Item[]>; messages: ChatMessage[]; attachments: Attachment[];
  tlRequests: TlRequest[]; summaries: Record<"teamLeader" | "spc", { text: string; byName: string } | null>; contacts: TripContact[]; vaccinations: VaccinationDeclaration[]; debrief: Debrief; finance: FinanceEntry[];
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
    attachments: attachments.map(toAtt), tlRequests: tl.map(toTl), contacts: (await sub("contacts")).map(toTripContact),
    summaries: await sub("summaries").then((x) => {
      const m = Object.fromEntries(x.map((d) => [d.id, { text: str(d.data.text), byName: str(d.data.byName) }]));
      return { teamLeader: m.teamLeader ?? null, spc: m.spc ?? null };
    }),
    vaccinations: vacc.map(toVacc).filter((v) => lead || v.uid === be().uid),
    debrief: toDebrief(debrief), finance: fin.map(toFin),
    financeNotes: Object.fromEntries(notes.map((n) => [n.id, { name: str(n.data.name), text: str(n.data.text) }])),
  };
}

/** Not used by the demo screens; kept so imports match ../store.ts. */
export const call = async () => { throw new Error("Not available in the demo."); };

// ---- Account manager (Administrator permission) ---------------------------------------------------

export interface RoleProfiles { host: boolean; controller: boolean; spc: boolean; admin: boolean }
export interface ManagedAccount {
  uid: string; name: string; email: string; emailVerified: boolean; disabled: boolean; invited: boolean;
  roles: RoleProfiles; createdAt: string; lastSignIn: string;
}
export async function listAccounts(): Promise<ManagedAccount[]> {
  return (await be().list("accounts")).map((a) => ({
    uid: a.id, name: str(a.data.name), email: str(a.data.email), emailVerified: a.data.emailVerified === true, disabled: false,
    invited: a.data.invited === true,
    roles: { host: a.data.host === true, controller: a.data.controller === true, spc: a.data.spc === true, admin: a.data.admin === true },
    createdAt: a.data.createdAt ? new Date(Number(a.data.createdAt)).toISOString() : "", lastSignIn: "",
  })).sort((x, y) => (x.name || x.email).localeCompare(y.name || y.email));
}
/** Demo: a pre-created account the person claims by signing up with the same email. */
export async function createAccount(a: { name: string; email: string; roles: RoleProfiles }) {
  const email = a.email.trim().toLowerCase();
  if ((await be().list("accounts", { where: [["email", "==", email]] })).length) throw new Error("An account already exists for that email.");
  const id = `invited-${be().newId()}`;
  await be().set(`accounts/${id}`, { name: a.name.trim(), email, emailVerified: true, invited: true, ...a.roles, passkeys: [], createdAt: now() });
  return { uid: id, setupLink: "" };
}
export async function setAccountRoles(uid: string, roles: RoleProfiles) {
  if (uid === be().uid && !roles.admin) throw new Error("You can't remove your own Administrator permission.");
  await be().patch(`accounts/${uid}`, { ...roles });
}
export async function deleteManagedAccount(uid: string) {
  if (uid === be().uid) throw new Error("You can't delete your own account here.");
  const trips = await be().list("trips", { where: [["memberUids", "array-contains", uid]] });
  for (const t of trips) {
    const roles = (t.data.roles ?? {}) as Record<string, RoleHolder>;
    for (const r of Object.values(roles)) if (r?.uid === uid) r.uid = null;
    await be().patch(`trips/${t.id}`, { roles, extraAccessUids: ((t.data.extraAccessUids as string[] | undefined) ?? []).filter((x) => x !== uid), ...(t.data.requesterUid === uid ? { requesterUid: DELETE } : {}) });
    for (const f of await be().list(`trips/${t.id}/flights`)) {
      const ps = (f.data.passengers ?? []) as Record<string, unknown>[];
      if (ps.some((p) => p?.uid === uid)) await be().patch(`trips/${t.id}/flights/${f.id}`, { passengers: ps.map((p) => (p?.uid === uid ? { name: p.name, travelClass: p.travelClass } : p)) });
    }
    await recomputeAccess(t.id);
  }
  await be().del(`accounts/${uid}`);
}
/** Demo sign-up: take over an account an administrator created for this email (roles carry over). */
export async function claimInvitedAccount(email: string): Promise<Partial<RoleProfiles>> {
  const hits = (await be().list("accounts", { where: [["email", "==", email.toLowerCase()]] })).filter((h) => h.data.invited === true && h.id !== be().uid);
  if (!hits.length) return {};
  const roles = { host: hits[0].data.host === true, controller: hits[0].data.controller === true, spc: hits[0].data.spc === true, admin: hits[0].data.admin === true };
  for (const h of hits) await be().del(`accounts/${h.id}`);
  return roles;
}

export async function myTripReasons(tripId: string, uid: string): Promise<string[]> {
  const d = await be().get(`trips/${tripId}/members/${uid}`);
  return Array.isArray(d?.data.reasons) ? (d!.data.reasons as unknown[]).map(String) : [];
}

// ---- Notifications (demo: in-app inbox only — an artifact can't receive push) -------------------

export interface AppNotification { id: string; type: string; title: string; body: string; tripId: string; link: string; read: boolean; createdAtMs: number }
export const useNotifications = (uid: string) =>
  useColl(`users/${uid}/notifications`, { orderBy: ["createdAt", "desc"] }, (s) => ({
    id: s.id, type: str(s.data.type), title: str(s.data.title), body: str(s.data.body), tripId: str(s.data.tripId), link: str(s.data.link),
    read: s.data.read === true, createdAtMs: ms(s.data.createdAt),
  }), uid);
export const markNotificationRead = (uid: string, id: string) => be().patch(`users/${uid}/notifications/${id}`, { read: true });
export const clearNotification = (uid: string, id: string) => be().del(`users/${uid}/notifications/${id}`);
export type PushState = "unsupported" | "blocked" | "off" | "on";
export const pushState = async (): Promise<PushState> => "unsupported";
export const enablePush = async (_uid: string): Promise<PushState> => "unsupported";
export const disablePush = async (_uid: string) => undefined;

/** What the Cloud Functions do in production: write the inbox entries (never to the actor). */
async function notifyDemo(uids: string[], note: { type: string; title: string; body: string; tripId: string; link: string }) {
  for (const uid of new Set(uids.filter((u) => u && u !== be().uid))) {
    await be().set(`users/${uid}/notifications/${be().newId()}`, { ...note, read: false, createdAt: now() });
  }
}
