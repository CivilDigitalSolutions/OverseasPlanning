/**
 * All Firestore / Storage / Functions access for the app. Components never call Firebase directly
 * (same rule as TrackLink: repositories own data access). Shapes: docs/SPEC.md §4.
 */
import { onIdTokenChanged, type User } from "firebase/auth";
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
  type DocumentData, type DocumentSnapshot, type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { useEffect, useState } from "react";
import { auth, db, functions, storage } from "./firebase";
import {
  EMPTY_DEBRIEF, MAX_ATTACHMENT_BYTES, PRIVACY_VERSION, TERMS_VERSION, safeFileName,
  REQUEST_KINDS, type ChatMessage, type Debrief, type FinanceEntry, type RequestKind, type TlRequestStatus,
  type VaccinationDeclaration, type VaccineRecord, type RequestInput, type RoleHolder, type TlRequest, type Trip, type TripRequest,
  type TripRoleKey, type TripStatus,
} from "./model";

export const call = async <T,>(name: string, data: unknown = {}): Promise<T> =>
  (await httpsCallable<unknown, T>(functions, name)(data)).data;

const ms = (t: unknown) => (t as Timestamp | null)?.toMillis?.() ?? 0;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const dataOf = (d: DocumentSnapshot): DocumentData => d.data({ serverTimestamps: "estimate" }) ?? {};

// ---- Session ----------------------------------------------------------------------------------

export interface Session {
  user: User;
  uid: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isHost: boolean;
  isAdmin: boolean;
}

/** undefined = still loading, null = signed out. Claims (host/admin) come from the ID token. */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(undefined);
  useEffect(() => onIdTokenChanged(auth, async (user) => {
    if (!user) { setS(null); return; }
    const token = await user.getIdTokenResult().catch(() => null);
    const c = token?.claims ?? {};
    setS({
      user, uid: user.uid, email: user.email ?? "", name: user.displayName || user.email || "",
      emailVerified: user.emailVerified, isHost: c.host === true, isAdmin: c.admin === true,
    });
  }), []);
  return s;
}

/** Re-read the user record (after confirming the email) and force fresh claims. */
export async function refreshSession(): Promise<boolean> {
  const u = auth.currentUser;
  if (!u) return false;
  await u.reload();
  await u.getIdToken(true);
  return u.emailVerified;
}

export type AgreementMethod = "signup" | "password" | "passkey";

/** Records agreement to the terms + privacy policy for this sign-in (server stamps time, IP, agent). */
export const recordAgreement = (method: AgreementMethod) =>
  call("recordAgreement", { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, method, userAgent: navigator.userAgent.slice(0, 400) });

/** Move any trip access granted to my email before I had an account onto my account. */
export const syncPendingAccess = () => call<{ added: number }>("syncPendingAccess");

// ---- Trip requests ----------------------------------------------------------------------------

const toRequest = (d: DocumentSnapshot): TripRequest => {
  const v = dataOf(d);
  return {
    id: d.id, teamName: str(v.teamName), startDate: str(v.startDate), endDate: str(v.endDate), location: str(v.location),
    requesterUid: str(v.requesterUid), requesterName: str(v.requesterName), requesterEmail: str(v.requesterEmail),
    status: v.status === "accepted" || v.status === "declined" ? v.status : "submitted",
    tripId: typeof v.tripId === "string" ? v.tripId : null, declineReason: str(v.declineReason), createdAtMs: ms(v.createdAt),
  };
};

export function submitRequest(s: Session, r: RequestInput) {
  return addDoc(collection(db, "tripRequests"), {
    teamName: r.teamName.trim(), startDate: r.startDate, endDate: r.endDate, location: r.location.trim(),
    requesterUid: s.uid, requesterName: s.name.slice(0, 80), requesterEmail: s.email,
    status: "submitted", createdAt: serverTimestamp(),
  });
}

/** HOST sees every request; everyone else sees their own. */
export function useRequests(s: Session): TripRequest[] | null {
  const [list, setList] = useState<TripRequest[] | null>(null);
  useEffect(() => {
    const base = collection(db, "tripRequests");
    const q = s.isHost ? query(base, orderBy("createdAt", "desc")) : query(base, where("requesterUid", "==", s.uid), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => setList(snap.docs.map(toRequest)), () => setList([]));
  }, [s.uid, s.isHost]);
  return list;
}

export function useRequest(id: string): TripRequest | null | undefined {
  const [r, setR] = useState<TripRequest | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, "tripRequests", id), (d) => setR(d.exists() ? toRequest(d) : null), () => setR(null)), [id]);
  return r;
}

export const declineRequest = (id: string, reason: string) =>
  updateDoc(doc(db, "tripRequests", id), { status: "declined", declineReason: reason.trim().slice(0, 500), decidedAt: serverTimestamp() });

export interface CreateTripInput {
  requestId: string;
  name: string;
  cyberRisk: string;
  cyberRationale: string;
  countryRisk: string;
  countryRationale: string;
  roles: Partial<Record<TripRoleKey, RoleHolder>>;
}
export const createTrip = (input: CreateTripInput) => call<{ tripId: string }>("createTrip", input);

// ---- Trips ------------------------------------------------------------------------------------

const toTrip = (d: DocumentSnapshot): Trip => {
  const v = dataOf(d);
  const roles: Trip["roles"] = {};
  for (const [k, r] of Object.entries((v.roles ?? {}) as Record<string, Record<string, unknown>>)) {
    roles[k as TripRoleKey] = { name: str(r?.name), email: str(r?.email), uid: typeof r?.uid === "string" ? r.uid : null };
  }
  return {
    id: d.id, name: str(v.name), teamName: str(v.teamName), location: str(v.location), startDate: str(v.startDate), endDate: str(v.endDate),
    status: (["planning", "live", "archived"].includes(v.status) ? v.status : "planning") as TripStatus,
    cyberRisk: str(v.cyberRisk), cyberRationale: str(v.cyberRationale), countryRisk: str(v.countryRisk), countryRationale: str(v.countryRationale),
    roles, memberUids: Array.isArray(v.memberUids) ? v.memberUids : [], pendingEmails: Array.isArray(v.pendingEmails) ? v.pendingEmails : [],
    requestId: typeof v.requestId === "string" ? v.requestId : null, createdByName: str(v.createdByName), createdByEmail: str(v.createdByEmail),
    dipAgreed: v.dipAgreed === true, dipAgreedDate: str(v.dipAgreedDate),
    createdAtMs: ms(v.createdAt),
  };
};

/** HOST sees every trip; everyone else sees the trips they have been given access to. */
export function useTrips(s: Session): Trip[] | null {
  const [list, setList] = useState<Trip[] | null>(null);
  useEffect(() => {
    const base = collection(db, "trips");
    const q = s.isHost ? query(base) : query(base, where("memberUids", "array-contains", s.uid));
    return onSnapshot(q, (snap) => setList(snap.docs.map(toTrip)), () => setList([]));
  }, [s.uid, s.isHost]);
  return list;
}

export function useTrip(id: string): Trip | null | undefined {
  const [t, setT] = useState<Trip | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, "trips", id), (d) => setT(d.exists() ? toTrip(d) : null), () => setT(null)), [id]);
  return t;
}

export interface MemberProfile { uid: string; name: string; email: string; addedByName: string; addedAtMs: number }

/** Who can see a trip (written only by functions: addTripAccess / createTrip). */
export function useMembers(tripId: string): MemberProfile[] | null {
  const [list, setList] = useState<MemberProfile[] | null>(null);
  useEffect(() => onSnapshot(collection(db, "trips", tripId, "members"), (snap) => setList(snap.docs.map((d) => {
    const v = dataOf(d);
    return { uid: d.id, name: str(v.name), email: str(v.email), addedByName: str(v.addedByName), addedAtMs: ms(v.addedAt) };
  })), () => setList([])), [tripId]);
  return list;
}

/** HOST edits the overview (risks, name, dates, location). Rules limit the keys. */
export const updateTripOverview = (id: string, patch: Partial<Pick<Trip, "name" | "location" | "startDate" | "endDate" | "cyberRisk" | "cyberRationale" | "countryRisk" | "countryRationale">>) =>
  updateDoc(doc(db, "trips", id), { ...patch, updatedAt: serverTimestamp() });

export const setTripStatus = (id: string, status: TripStatus) => updateDoc(doc(db, "trips", id), { status, updatedAt: serverTimestamp() });

/** HOST or the Team Leader records the DiP agreement (an agreed DiP always carries its date). */
export const setDipAgreed = (id: string, agreed: boolean, date: string) =>
  updateDoc(doc(db, "trips", id), { dipAgreed: agreed, dipAgreedDate: agreed ? date : "", updatedAt: serverTimestamp() });

export const updateTripRoles = (tripId: string, roles: Partial<Record<TripRoleKey, RoleHolder>>) => call("updateTripRoles", { tripId, roles });

export const addTripAccess = (tripId: string, email: string, name: string) =>
  call<{ status: "added" | "pending" | "already" }>("addTripAccess", { tripId, email, name });
export const removeTripAccess = (tripId: string, target: { uid?: string; email?: string }) => call("removeTripAccess", { tripId, ...target });

// ---- Planning items (flights, hotels, cars, assets) --------------------------------------------

export interface Item { id: string; values: Record<string, unknown>; createdByName: string; updatedAtMs: number }

export function useItems(tripId: string, coll: string): Item[] | null {
  const [list, setList] = useState<Item[] | null>(null);
  useEffect(() => onSnapshot(query(collection(db, "trips", tripId, coll), orderBy("createdAt", "asc")), (snap) => setList(snap.docs.map((d) => {
    const { createdAt: _c, updatedAt, createdBy: _b, createdByName, ...values } = dataOf(d);
    return { id: d.id, values, createdByName: str(createdByName), updatedAtMs: ms(updatedAt) };
  })), () => setList([])), [tripId, coll]);
  return list;
}

export const addItem = (s: Session, tripId: string, coll: string, values: Record<string, unknown>) =>
  addDoc(collection(db, "trips", tripId, coll), {
    ...values, createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

/** Full replacement of the item's own fields (set with merge:false would lose createdBy, so rebuild). */
export const updateItem = (tripId: string, coll: string, id: string, values: Record<string, unknown>, keys: string[]) =>
  updateDoc(doc(db, "trips", tripId, coll, id), {
    ...Object.fromEntries(keys.map((k) => [k, k in values ? values[k] : deleteField()])),
    updatedAt: serverTimestamp(),
  });

export const deleteItem = (tripId: string, coll: string, id: string) => deleteDoc(doc(db, "trips", tripId, coll, id));

// ---- Messages ---------------------------------------------------------------------------------

export function useMessages(tripId: string): ChatMessage[] | null {
  const [list, setList] = useState<ChatMessage[] | null>(null);
  useEffect(() => onSnapshot(
    query(collection(db, "trips", tripId, "messages"), orderBy("createdAt", "asc")),
    { includeMetadataChanges: true },
    (snap) => setList(snap.docs.map((d) => {
      const v = dataOf(d);
      return {
        id: d.id, senderUid: str(v.senderUid), senderName: str(v.senderName), text: str(v.text),
        createdAtMs: ms(v.createdAt) || Date.now(), pending: d.metadata.hasPendingWrites,
      };
    })),
    () => setList([]),
  ), [tripId]);
  return list;
}

export const sendMessage = (s: Session, tripId: string, text: string) =>
  addDoc(collection(db, "trips", tripId, "messages"), {
    senderUid: s.uid, senderName: s.name.slice(0, 80), text, createdAt: serverTimestamp(),
  });

export const deleteMessage = (tripId: string, id: string) => deleteDoc(doc(db, "trips", tripId, "messages", id));

/** My last-read time per trip (users/{uid}/tripReads/{tripId}), for the unread line and badges. */
export function useReadAt(uid: string, tripId: string): number | null {
  const [t, setT] = useState<number | null>(null);
  useEffect(() => onSnapshot(doc(db, "users", uid, "tripReads", tripId), (d) => setT(ms(d.data()?.readAt)), () => setT(0)), [uid, tripId]);
  return t;
}
export const markRead = (uid: string, tripId: string) =>
  setDoc(doc(db, "users", uid, "tripReads", tripId), { readAt: serverTimestamp() });

// ---- Attachments ------------------------------------------------------------------------------

export interface Attachment { id: string; name: string; path: string; size: number; contentType: string; uploadedByName: string; uploadedBy: string; createdAtMs: number }

export function useAttachments(tripId: string): Attachment[] | null {
  const [list, setList] = useState<Attachment[] | null>(null);
  useEffect(() => onSnapshot(query(collection(db, "trips", tripId, "attachments"), orderBy("createdAt", "desc")), (snap) => setList(snap.docs.map((d) => {
    const v = dataOf(d);
    return {
      id: d.id, name: str(v.name), path: str(v.path), size: typeof v.size === "number" ? v.size : 0, contentType: str(v.contentType),
      uploadedBy: str(v.uploadedBy), uploadedByName: str(v.uploadedByName), createdAtMs: ms(v.createdAt),
    };
  })), () => setList([])), [tripId]);
  return list;
}

/** Upload to Storage first, then record it; a failed record removes the orphaned object. */
export async function uploadAttachment(s: Session, tripId: string, file: File, onProgress: (pct: number) => void) {
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("That file is larger than 25 MB.");
  const id = doc(collection(db, "trips", tripId, "attachments")).id;
  const path = `trips/${tripId}/attachments/${id}/${safeFileName(file.name)}`;
  const ref = storageRef(storage, path);
  const task = uploadBytesResumable(ref, file, { contentType: file.type || "application/octet-stream", customMetadata: { uploadedBy: s.uid } });
  await new Promise<void>((resolve, reject) => task.on("state_changed",
    (t) => onProgress(Math.round((t.bytesTransferred / Math.max(1, t.totalBytes)) * 100)), reject, () => resolve()));
  try {
    await setDoc(doc(db, "trips", tripId, "attachments", id), {
      name: file.name.slice(0, 200), path, size: file.size, contentType: (file.type || "application/octet-stream").slice(0, 120),
      uploadedBy: s.uid, uploadedByName: s.name.slice(0, 80), createdAt: serverTimestamp(),
    });
  } catch (e) {
    await deleteObject(ref).catch(() => undefined);
    throw e;
  }
}

export const attachmentUrl = (a: Attachment) => getDownloadURL(storageRef(storage, a.path));
export async function openAttachment(a: Attachment) { window.open(await attachmentUrl(a), "_blank", "noopener"); }

export async function deleteAttachment(tripId: string, a: Attachment) {
  await deleteObject(storageRef(storage, a.path)).catch(() => undefined);
  await deleteDoc(doc(db, "trips", tripId, "attachments", a.id));
}

// ---- Requests to the Team Leader (approval workflow) ---------------------------------------------

const num = (v: unknown) => (typeof v === "number" ? v : null);
const toTl = (d: DocumentSnapshot): TlRequest => {
  const v = dataOf(d);
  const st = ["pending", "approved", "rejected", "completed"].includes(v.status) ? v.status : "pending";
  return {
    id: d.id, kind: (REQUEST_KINDS.some((k) => k.key === v.kind) ? v.kind : "resource") as RequestKind,
    title: str(v.title), details: str(v.details), quantity: num(v.quantity), amount: num(v.amount), currency: str(v.currency),
    neededBy: str(v.neededBy), createdBy: str(v.createdBy), createdByName: str(v.createdByName), createdAtMs: ms(v.createdAt),
    status: st as TlRequestStatus, decidedByName: str(v.decidedByName), decidedAtMs: ms(v.decidedAt), decisionNote: str(v.decisionNote),
    completedByName: str(v.completedByName), completedAtMs: ms(v.completedAt), response: str(v.response),
  };
};

export function useTlRequests(tripId: string): TlRequest[] | null {
  const [list, setList] = useState<TlRequest[] | null>(null);
  useEffect(() => onSnapshot(collection(db, "trips", tripId, "tlRequests"), (snap) => setList(snap.docs.map(toTl)), () => setList([])), [tripId]);
  return list;
}

export interface TlRequestInput { kind: RequestKind; title: string; details: string; quantity: number | null; amount: number | null; currency: string; neededBy: string }

export const addTlRequest = (s: Session, tripId: string, r: TlRequestInput) =>
  addDoc(collection(db, "trips", tripId, "tlRequests"), {
    kind: r.kind, title: r.title.trim(), details: r.details.trim(),
    ...(r.quantity !== null ? { quantity: r.quantity } : {}),
    ...(r.amount !== null ? { amount: r.amount, currency: r.currency } : {}),
    ...(r.neededBy ? { neededBy: r.neededBy } : {}),
    createdBy: s.uid, createdByName: s.name.slice(0, 80), createdAt: serverTimestamp(), status: "pending",
  });

/** Team Leader / HOST: approve or reject a pending request. */
export const decideTlRequest = (s: Session, tripId: string, id: string, approve: boolean, note: string) =>
  updateDoc(doc(db, "trips", tripId, "tlRequests", id), {
    status: approve ? "approved" : "rejected", decidedBy: s.uid, decidedByName: s.name.slice(0, 80),
    decidedAt: serverTimestamp(), decisionNote: note.trim().slice(0, 1000),
  });

/** Team Leader / HOST: mark an approved request as done. */
export const completeTlRequest = (s: Session, tripId: string, id: string, response: string) =>
  updateDoc(doc(db, "trips", tripId, "tlRequests", id), {
    status: "completed", completedBy: s.uid, completedByName: s.name.slice(0, 80), completedAt: serverTimestamp(), response: response.trim().slice(0, 1000),
  });

/** The creator resubmits a rejected request; it goes back for a fresh decision. */
export const resubmitTlRequest = (tripId: string, id: string) =>
  updateDoc(doc(db, "trips", tripId, "tlRequests", id), {
    status: "pending", decidedBy: deleteField(), decidedByName: deleteField(), decidedAt: deleteField(), decisionNote: deleteField(),
  });

export const deleteTlRequest = (tripId: string, id: string) => deleteDoc(doc(db, "trips", tripId, "tlRequests", id));

// ---- Vaccination declarations ------------------------------------------------------------------

const toVacc = (d: DocumentSnapshot): VaccinationDeclaration => {
  const v = dataOf(d);
  return {
    uid: d.id, name: str(v.name), notes: str(v.notes), declared: v.declared === true, declaredAtMs: ms(v.declaredAt),
    vaccines: Array.isArray(v.vaccines) ? v.vaccines.map((x: Record<string, unknown>) => ({ name: str(x?.name), date: str(x?.date) })) : [],
  };
};

/**
 * The Team Leader and HOST read every declaration; anyone else can read only their own (health
 * data — firestore.rules). `all` chooses which query to run so the rules never refuse the listener.
 */
export function useVaccinations(tripId: string, uid: string, all: boolean): VaccinationDeclaration[] | null {
  const [list, setList] = useState<VaccinationDeclaration[] | null>(null);
  useEffect(() => {
    if (all) return onSnapshot(collection(db, "trips", tripId, "vaccinations"), (snap) => setList(snap.docs.map(toVacc)), () => setList([]));
    return onSnapshot(doc(db, "trips", tripId, "vaccinations", uid), (d) => setList(d.exists() ? [toVacc(d)] : []), () => setList([]));
  }, [tripId, uid, all]);
  return list;
}

export const saveVaccination = (s: Session, tripId: string, vaccines: VaccineRecord[], notes: string, declared: boolean) =>
  setDoc(doc(db, "trips", tripId, "vaccinations", s.uid), {
    name: s.name.slice(0, 80), vaccines, notes: notes.trim().slice(0, 2000), declared,
    ...(declared ? { declaredAt: serverTimestamp() } : {}), updatedAt: serverTimestamp(),
  });

// ---- Debrief ----------------------------------------------------------------------------------

export function useDebrief(tripId: string): Debrief | null {
  const [d, setD] = useState<Debrief | null>(null);
  useEffect(() => onSnapshot(doc(db, "trips", tripId, "debrief", "current"), (snap) => {
    const v = dataOf(snap);
    setD(snap.exists() ? {
      wentWell: str(v.wentWell), couldBeBetter: str(v.couldBeBetter), welfareConcerns: str(v.welfareConcerns),
      injuryRefs: Array.isArray(v.injuryRefs) ? v.injuryRefs.map(String) : [], reciprocityIssues: v.reciprocityIssues === true,
      reciprocityDescription: str(v.reciprocityDescription), updatedBy: str(v.updatedByName), updatedAtMs: ms(v.updatedAt),
    } : EMPTY_DEBRIEF);
  }, () => setD(EMPTY_DEBRIEF)), [tripId]);
  return d;
}

export const saveDebrief = (s: Session, tripId: string, d: Omit<Debrief, "updatedBy" | "updatedAtMs">) =>
  setDoc(doc(db, "trips", tripId, "debrief", "current"), {
    ...d, updatedByUid: s.uid, updatedByName: s.name.slice(0, 80), updatedAt: serverTimestamp(),
  });

// ---- HOST administration ------------------------------------------------------------------------

export const setHostRole = (email: string, host: boolean) => call<{ uid: string }>("setHostRole", { email, host });

// ---- Financial debrief ------------------------------------------------------------------------
// Each traveller keeps their own entries and notes; everyone on the trip can read them, only the
// owner (or HOST) can change them (firestore.rules financeEntries / financeNotes).

export function useFinanceEntries(tripId: string): FinanceEntry[] | null {
  const [list, setList] = useState<FinanceEntry[] | null>(null);
  useEffect(() => onSnapshot(collection(db, "trips", tripId, "financeEntries"), (snap) => setList(snap.docs.map((d) => {
    const v = dataOf(d);
    return {
      id: d.id, ownerUid: str(v.ownerUid), ownerName: str(v.ownerName), date: str(v.date), category: str(v.category),
      description: str(v.description), amount: typeof v.amount === "number" ? v.amount : 0, currency: str(v.currency) || "GBP",
      paymentMethod: str(v.paymentMethod), receiptRef: str(v.receiptRef), updatedAtMs: ms(v.updatedAt),
    };
  })), () => setList([])), [tripId]);
  return list;
}

export const saveFinanceEntry = (s: Session, tripId: string, id: string | null, e: Omit<FinanceEntry, "id" | "ownerUid" | "ownerName" | "updatedAtMs">) => {
  const body = { ...e, ownerUid: s.uid, ownerName: s.name.slice(0, 80), updatedAt: serverTimestamp() };
  return id ? setDoc(doc(db, "trips", tripId, "financeEntries", id), body) : addDoc(collection(db, "trips", tripId, "financeEntries"), body);
};
export const deleteFinanceEntry = (tripId: string, id: string) => deleteDoc(doc(db, "trips", tripId, "financeEntries", id));

export function useFinanceNotes(tripId: string): Record<string, { name: string; text: string; updatedAtMs: number }> | null {
  const [m, setM] = useState<Record<string, { name: string; text: string; updatedAtMs: number }> | null>(null);
  useEffect(() => onSnapshot(collection(db, "trips", tripId, "financeNotes"), (snap) =>
    setM(Object.fromEntries(snap.docs.map((d) => { const v = dataOf(d); return [d.id, { name: str(v.name), text: str(v.text), updatedAtMs: ms(v.updatedAt) }]; }))),
  () => setM({})), [tripId]);
  return m;
}
export const saveFinanceNote = (s: Session, tripId: string, text: string) =>
  setDoc(doc(db, "trips", tripId, "financeNotes", s.uid), { name: s.name.slice(0, 80), text: text.trim(), updatedAt: serverTimestamp() });

// ---- Whole-trip snapshot for the PDF export -----------------------------------------------------

export interface TripSnapshot {
  trip: Trip;
  members: MemberProfile[];
  items: Record<string, Item[]>;
  messages: ChatMessage[];
  attachments: Attachment[];
  tlRequests: TlRequest[];
  vaccinations: VaccinationDeclaration[];
  debrief: Debrief;
  finance: FinanceEntry[];
  financeNotes: Record<string, { name: string; text: string }>;
}

/** One-shot read of every part of a trip (served from the offline cache when there is no signal). */
export async function loadTripSnapshot(tripId: string): Promise<TripSnapshot> {
  const t = await getDoc(doc(db, "trips", tripId));
  if (!t.exists()) throw new Error("Trip not found.");
  const sub = (name: string) => getDocs(collection(db, "trips", tripId, name));
  const [members, flights, hotels, cars, assets, messages, attachments, tl, debrief, fin, notes] = await Promise.all([
    sub("members"), sub("flights"), sub("hotels"), sub("cars"), sub("assets"), sub("messages"), sub("attachments"), sub("tlRequests"),
    getDoc(doc(db, "trips", tripId, "debrief", "current")), sub("financeEntries"), sub("financeNotes"),
  ]);
  // Declarations are health data: the full set only for those allowed to read it, otherwise just mine.
  const vaccinations = await sub("vaccinations").then((x) => x.docs.map(toVacc)).catch(async () => {
    const mine = auth.currentUser ? await getDoc(doc(db, "trips", tripId, "vaccinations", auth.currentUser.uid)).catch(() => null) : null;
    return mine?.exists() ? [toVacc(mine)] : [];
  });
  const items = (snap: Awaited<ReturnType<typeof sub>>): Item[] => snap.docs.map((d) => {
    const { createdAt, updatedAt, createdBy: _b, createdByName, ...values } = dataOf(d);
    return { id: d.id, values, createdByName: str(createdByName), updatedAtMs: ms(updatedAt) || ms(createdAt) };
  });
  const v = (d: DocumentSnapshot) => dataOf(d);
  const db0 = v(debrief);
  return {
    trip: toTrip(t),
    members: members.docs.map((d) => ({ uid: d.id, name: str(v(d).name), email: str(v(d).email), addedByName: str(v(d).addedByName), addedAtMs: ms(v(d).addedAt) })),
    items: { flights: items(flights), hotels: items(hotels), cars: items(cars), assets: items(assets) },
    messages: messages.docs.map((d) => ({ id: d.id, senderUid: str(v(d).senderUid), senderName: str(v(d).senderName), text: str(v(d).text), createdAtMs: ms(v(d).createdAt), pending: false }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs),
    attachments: attachments.docs.map((d) => ({ id: d.id, name: str(v(d).name), path: str(v(d).path), size: Number(v(d).size) || 0, contentType: str(v(d).contentType), uploadedBy: str(v(d).uploadedBy), uploadedByName: str(v(d).uploadedByName), createdAtMs: ms(v(d).createdAt) })),
    tlRequests: tl.docs.map(toTl),
    vaccinations,
    debrief: debrief.exists() ? {
      wentWell: str(db0.wentWell), couldBeBetter: str(db0.couldBeBetter), welfareConcerns: str(db0.welfareConcerns),
      injuryRefs: Array.isArray(db0.injuryRefs) ? db0.injuryRefs.map(String) : [], reciprocityIssues: db0.reciprocityIssues === true,
      reciprocityDescription: str(db0.reciprocityDescription), updatedBy: str(db0.updatedByName), updatedAtMs: ms(db0.updatedAt),
    } : EMPTY_DEBRIEF,
    finance: fin.docs.map((d) => ({ id: d.id, ownerUid: str(v(d).ownerUid), ownerName: str(v(d).ownerName), date: str(v(d).date), category: str(v(d).category), description: str(v(d).description), amount: Number(v(d).amount) || 0, currency: str(v(d).currency) || "GBP", paymentMethod: str(v(d).paymentMethod), receiptRef: str(v(d).receiptRef), updatedAtMs: ms(v(d).updatedAt) })),
    financeNotes: Object.fromEntries(notes.docs.map((d) => [d.id, { name: str(v(d).name), text: str(v(d).text) }])),
  };
}
