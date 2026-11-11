/**
 * Firestore rules tests. Run:
 *   firebase emulators:exec --only firestore "npm --prefix functions run test:rules"
 */
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, serverTimestamp, deleteField } = require("firebase/firestore");

let env;
const TRIP = "trip1";
const OTHER = "trip2";

const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true, ...claims }).firestore();
const host = () => as("host", { host: true });
const member = () => as("alice");
const leader = () => as("lead");
const spc = () => as("spc");
const outsider = () => as("eve");
const unverified = () => env.authenticatedContext("alice", { email: "alice@x.com", email_verified: false }).firestore();

const tripDoc = (members) => ({
  name: "Trip", teamName: "Alpha", location: "Paris", startDate: "2026-05-01", endDate: "2026-05-07", status: "planning",
  cyberRisk: "Low", cyberRationale: "r", countryRisk: "Low", countryRationale: "r",
  roles: { teamLeader: { name: "Lead", email: "lead@x.com", uid: "lead" }, spc: { name: "Sam", email: "spc@x.com", uid: "spc" } },
  memberUids: members, pendingEmails: [],
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-overseas",
    firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "..", "firestore.rules"), "utf8") },
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "trips", TRIP), tripDoc(["alice", "lead", "spc"]));
    await setDoc(doc(db, "trips", OTHER), tripDoc(["bob"]));
    await setDoc(doc(db, "tripRequests", "r1"), { teamName: "A", startDate: "2026-01-01", endDate: "2026-01-02", location: "X", requesterUid: "alice", requesterEmail: "alice@x.com", status: "submitted" });
    await setDoc(doc(db, "trips", TRIP, "tlRequests", "q1"), { kind: "cash", title: "Float", createdBy: "alice", status: "pending", amount: 100, currency: "GBP" });
    await setDoc(doc(db, "trips", TRIP, "vaccinations", "alice"), { name: "Alice", vaccines: [], declared: false });
    await setDoc(doc(db, "trips", TRIP, "financeEntries", "f1"), { ownerUid: "alice", description: "Taxi", amount: 10, currency: "GBP" });
  });
});

const goodRequest = (uid = "alice") => ({
  teamName: "Team", startDate: "2026-03-01", endDate: "2026-03-04", location: "Rome", requesterUid: uid, requesterName: "A",
  requesterEmail: `${uid}@x.com`, status: "submitted", createdAt: serverTimestamp(),
});

describe("trip requests", () => {
  it("1 a verified user submits a well-formed request", () => assertSucceeds(addDoc(collection(member(), "tripRequests"), goodRequest())));
  it("2 an unverified user cannot submit", () => assertFails(addDoc(collection(unverified(), "tripRequests"), goodRequest())));
  it("3 cannot submit as someone else or pre-accepted", async () => {
    await assertFails(addDoc(collection(member(), "tripRequests"), goodRequest("bob")));
    await assertFails(addDoc(collection(member(), "tripRequests"), { ...goodRequest(), status: "accepted" }));
    await assertFails(addDoc(collection(member(), "tripRequests"), { ...goodRequest(), endDate: "2026-02-01" }));
  });
  it("4 requester reads own; others cannot; HOST reads all", async () => {
    await assertSucceeds(getDoc(doc(member(), "tripRequests", "r1")));
    await assertFails(getDoc(doc(outsider(), "tripRequests", "r1")));
    await assertSucceeds(getDocs(collection(host(), "tripRequests")));
    await assertFails(getDocs(collection(member(), "tripRequests")));
    await assertSucceeds(getDocs(query(collection(member(), "tripRequests"), where("requesterUid", "==", "alice"))));
  });
  it("5 only HOST declines; nobody accepts directly", async () => {
    await assertFails(updateDoc(doc(member(), "tripRequests", "r1"), { status: "declined", decidedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(host(), "tripRequests", "r1"), { status: "accepted", decidedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(host(), "tripRequests", "r1"), { status: "declined", declineReason: "No", decidedAt: serverTimestamp() }));
  });
});

describe("trips", () => {
  it("6 members and HOST read; outsiders and other trips' members do not (cross-trip denial)", async () => {
    await assertSucceeds(getDoc(doc(member(), "trips", TRIP)));
    await assertSucceeds(getDoc(doc(host(), "trips", TRIP)));
    await assertFails(getDoc(doc(outsider(), "trips", TRIP)));
    await assertFails(getDoc(doc(member(), "trips", OTHER)));
    await assertFails(getDoc(doc(unverified(), "trips", TRIP)));
  });
  it("7 member list query must be scoped to memberUids", async () => {
    await assertSucceeds(getDocs(query(collection(member(), "trips"), where("memberUids", "array-contains", "alice"))));
    await assertFails(getDocs(collection(member(), "trips")));
  });
  it("8 nobody creates trips or grants access from a client", async () => {
    await assertFails(setDoc(doc(host(), "trips", "new"), tripDoc(["host"])));
    await assertFails(updateDoc(doc(host(), "trips", TRIP), { memberUids: ["alice", "eve"], updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), { memberUids: ["alice", "lead", "eve"], updatedAt: serverTimestamp() }));
  });
  // Every client edit carries the editor's uid (rules: updatedBy == caller).
  const ed = (uid, o) => ({ ...o, updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid });
  it("9 anyone on the trip edits overview fields; outsiders cannot; status is HOST or Team Leader only", async () => {
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP), ed("alice", { cyberRisk: "High", cyberRationale: "Changed", teamName: "Team B", location: "Porto", name: "Porto trip" })));
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP), ed("alice", { startDate: "2026-05-02", endDate: "2026-05-09" })));
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP), ed("alice", { createdByName: "Hana Host", createdByEmail: "hana@x.com" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { endDate: "2026-04-01" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { cyberRisk: "Extreme" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { teamName: "" })));
    await assertFails(updateDoc(doc(outsider(), "trips", TRIP), ed("eve", { cyberRisk: "Low" })));
    await assertFails(updateDoc(doc(as("bob"), "trips", TRIP), ed("bob", { cyberRisk: "Low" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { status: "live" })));
    await assertSucceeds(updateDoc(doc(leader(), "trips", TRIP), ed("lead", { status: "live" })));
    await assertSucceeds(updateDoc(doc(host(), "trips", TRIP), ed("host", { status: "planning" })));
  });
  it("9a every edit is stamped with the editor; roles and access stay functions-only", async () => {
    await assertFails(updateDoc(doc(member(), "trips", TRIP), { cyberRisk: "Low", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("lead", { cyberRisk: "Low" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { roles: {} })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { memberUids: ["alice", "lead", "spc", "eve"] })));
  });
  it("9b DiP Agreed: anyone on the trip, an agreed DiP needs a date", async () => {
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP), ed("alice", { dipAgreed: true, dipAgreedDate: "2026-11-10" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { dipAgreed: true, dipAgreedDate: "" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { dipAgreed: false, dipAgreedDate: "2026-11-10" })));
    await assertSucceeds(updateDoc(doc(host(), "trips", TRIP), ed("host", { dipAgreed: false, dipAgreedDate: "" })));
    await assertFails(updateDoc(doc(as("bob"), "trips", TRIP), ed("bob", { dipAgreed: true, dipAgreedDate: "2026-11-10" })));
  });
  it("9c DiP classification: listed values only; anyone on the trip", async () => {
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP), ed("alice", { dipClassification: "PSA" })));
    await assertSucceeds(updateDoc(doc(leader(), "trips", TRIP), ed("lead", { dipClassification: "Event" })));
    await assertSucceeds(updateDoc(doc(host(), "trips", TRIP), ed("host", { dipClassification: "" })));
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { dipClassification: "Secret" })));
    await assertFails(updateDoc(doc(as("bob"), "trips", TRIP), ed("bob", { dipClassification: "CP" })));
  });
  it("10 members subcollection is read-only", async () => {
    await assertSucceeds(getDocs(collection(member(), "trips", TRIP, "members")));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "members", "eve"), { name: "Eve" }));
  });
});

describe("planning items, messages, attachments", () => {
  const flight = (uid) => ({ flightNumber: "BA1", from: "LHR", to: "CDG", passengers: ["A"], createdBy: uid, createdByName: "A", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  it("11 members add flights; outsiders cannot; unknown keys and collections refused", async () => {
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "flights"), flight("alice")));
    await assertFails(addDoc(collection(outsider(), "trips", TRIP, "flights"), flight("eve")));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), { ...flight("alice"), price: 1 }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "secrets"), flight("alice")));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), flight("bob")));
  });
  it("11b booking cost needs a currency; hire car fields validated", async () => {
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "hotels"), { name: "H", cost: 412.5, costCurrency: "EUR", guests: ["A"], createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "hotels"), { name: "H", cost: 412.5, createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), { ...flight("alice"), cost: "lots", costCurrency: "GBP" }));
    const car = { company: "Hertz", insuranceClass: "Group C", collectionLocation: "LIS", collectionDate: "2026-12-01", dropOffLocation: "LIS", dropOffDate: "2026-12-08", cost: 250, costCurrency: "EUR", drivers: ["A"], createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "cars"), car));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "cars"), { ...car, collectionDate: "1 Dec" }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "cars"), { ...car, pickUpAt: "2026-12-01T10:00" }));
  });
  it("12 messages: post as yourself, delete your own only", async () => {
    const ref = await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "messages"), { senderUid: "alice", senderName: "A", text: "hi", createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "messages"), { senderUid: "lead", text: "fake", createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(outsider(), "trips", TRIP, "messages"), { senderUid: "eve", text: "hi", createdAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(leader(), "trips", TRIP, "messages", ref.id)));
    await assertSucceeds(deleteDoc(doc(member(), "trips", TRIP, "messages", ref.id)));
  });
  it("13 attachment path must belong to this trip and record", async () => {
    const ok = { name: "a.pdf", path: `trips/${TRIP}/attachments/at1/a.pdf`, size: 10, contentType: "application/pdf", uploadedBy: "alice", uploadedByName: "A", createdAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "attachments", "at1"), ok));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "attachments", "at2"), { ...ok, path: `trips/${OTHER}/attachments/at2/a.pdf` }));
  });
});

describe("requests to the Team Leader (approval)", () => {
  const q = () => ({ kind: "flight", title: "Return flight", createdBy: "alice", createdByName: "A", createdAt: serverTimestamp(), status: "pending" });
  it("14 members raise requests as pending only", async () => {
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "tlRequests"), q()));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "tlRequests"), { ...q(), status: "approved" }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "tlRequests"), { ...q(), kind: "pony" }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "tlRequests"), { ...q(), kind: "cash", amount: 50 })); // no currency
  });
  it("15 ONLY the SPC approves — not the requester, the Team Leader or HOST", async () => {
    const decide = (uid) => ({ status: "approved", decidedBy: uid, decidedByName: "x", decidedAt: serverTimestamp() });
    await assertFails(updateDoc(doc(member(), "trips", TRIP, "tlRequests", "q1"), decide("alice")));
    await assertFails(updateDoc(doc(leader(), "trips", TRIP, "tlRequests", "q1"), decide("lead")));
    await assertFails(updateDoc(doc(host(), "trips", TRIP, "tlRequests", "q1"), decide("host")));
    await assertFails(updateDoc(doc(as("spc2"), "trips", OTHER, "tlRequests", "q1"), decide("spc2"))); // cross-trip
    await assertSucceeds(updateDoc(doc(spc(), "trips", TRIP, "tlRequests", "q1"), decide("spc")));
  });
  it("16 approval is final; resubmit only by the creator after rejection", async () => {
    const decide = (uid, status) => ({ status, decidedBy: uid, decidedByName: "x", decidedAt: serverTimestamp() });
    await assertSucceeds(updateDoc(doc(spc(), "trips", TRIP, "tlRequests", "q1"), { ...decide("spc", "rejected"), decisionNote: "No" }));
    await assertFails(updateDoc(doc(leader(), "trips", TRIP, "tlRequests", "q1"), { status: "pending", decidedBy: deleteField(), decidedAt: deleteField(), decisionNote: deleteField() }));
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP, "tlRequests", "q1"), { status: "pending", decidedBy: deleteField(), decidedByName: deleteField(), decidedAt: deleteField(), decisionNote: deleteField() }));
    await assertFails(updateDoc(doc(leader(), "trips", TRIP, "tlRequests", "q1"), decide("lead", "approved")));
    await assertSucceeds(updateDoc(doc(spc(), "trips", TRIP, "tlRequests", "q1"), decide("spc", "approved")));
    // Approved is the end: no completion step, no re-deciding, no resubmitting.
    await assertFails(updateDoc(doc(spc(), "trips", TRIP, "tlRequests", "q1"), { status: "completed", completedBy: "spc", completedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(spc(), "trips", TRIP, "tlRequests", "q1"), decide("spc", "rejected")));
    await assertFails(updateDoc(doc(member(), "trips", TRIP, "tlRequests", "q1"), { status: "pending", decidedBy: deleteField(), decidedAt: deleteField() }));
  });
});

describe("flights: new fields and SPC approval", () => {
  const fl = (o = {}) => ({
    flightStatus: "Requested", flightType: "Outbound", flightNumber: "TP1351", from: "LHR", departAt: "2026-12-01T07:10", to: "LIS",
    arriveAt: "2026-12-01T09:55", dayNight: "Day", durationMinutes: 165, cost: 612.4, costCurrency: "GBP", corporateTravel: "Yes",
    valueForMoney: "Yes", passengers: [{ name: "Jane", travelClass: "Business class" }],
    createdBy: "alice", createdByName: "A", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o,
  });
  const decide = (uid, o = {}) => ({ spcDecision: "approved", spcRationale: "Cheapest direct option.", spcDecidedBy: uid, spcDecidedByName: "S", spcDecidedAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o });
  beforeEach(() => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "trips", TRIP, "flights", "f1"), { ...fl(), createdAt: 1, updatedAt: 1 })));

  it("F1 members add flights with valid status/type/yes-no values only", async () => {
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "flights"), fl()));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), fl({ flightStatus: "Booked" })));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), fl({ flightType: "Return" })));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), fl({ corporateTravel: "Maybe" })));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), fl({ durationMinutes: 99999 })));
  });
  it("F2 nobody can create a flight already approved", () =>
    assertFails(addDoc(collection(spc(), "trips", TRIP, "flights"), fl({ createdBy: "spc", spcDecision: "approved", spcRationale: "x", spcDecidedBy: "spc", spcDecidedAt: serverTimestamp() }))));
  it("F3 ONLY the SPC records a decision, with a rationale", async () => {
    await assertFails(updateDoc(doc(member(), "trips", TRIP, "flights", "f1"), decide("alice")));
    await assertFails(updateDoc(doc(leader(), "trips", TRIP, "flights", "f1"), decide("lead")));
    await assertFails(updateDoc(doc(host(), "trips", TRIP, "flights", "f1"), decide("host")));
    await assertFails(updateDoc(doc(spc(), "trips", TRIP, "flights", "f1"), decide("spc", { spcRationale: "" })));
    await assertFails(updateDoc(doc(spc(), "trips", TRIP, "flights", "f1"), { ...decide("spc"), cost: 1 }));
    await assertSucceeds(updateDoc(doc(spc(), "trips", TRIP, "flights", "f1"), decide("spc")));
  });
  it("F4 editing a decided flight must clear the decision", async () => {
    await assertSucceeds(updateDoc(doc(spc(), "trips", TRIP, "flights", "f1"), decide("spc")));
    await assertFails(updateDoc(doc(member(), "trips", TRIP, "flights", "f1"), { cost: 900, updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(member(), "trips", TRIP, "flights", "f1"), {
      cost: 900, updatedAt: serverTimestamp(), spcDecision: deleteField(), spcRationale: deleteField(), spcDecidedBy: deleteField(), spcDecidedByName: deleteField(), spcDecidedAt: deleteField(),
    }));
  });
});

describe("request summaries and taxi", () => {
  const sum = (uid) => ({ text: "All good.", byUid: uid, byName: "X", updatedAt: serverTimestamp() });
  it("S1 anyone on the trip edits both summaries, stamped as themselves; outsiders cannot", async () => {
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "summaries", "teamLeader"), sum("alice")));
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "summaries", "spc"), sum("alice")));
    await assertSucceeds(setDoc(doc(host(), "trips", TRIP, "summaries", "spc"), sum("host")));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "summaries", "spc"), sum("lead")));
    await assertFails(setDoc(doc(as("bob"), "trips", TRIP, "summaries", "spc"), sum("bob")));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "summaries", "other"), sum("alice")));
    await assertSucceeds(getDoc(doc(member(), "trips", TRIP, "summaries", "spc")));
    await assertFails(getDoc(doc(outsider(), "trips", TRIP, "summaries", "spc")));
  });
  it("S2 taxi is a request type", () =>
    assertSucceeds(addDoc(collection(member(), "trips", TRIP, "tlRequests"), { kind: "taxi", title: "Airport transfer", details: "Late arrival", createdBy: "alice", createdAt: serverTimestamp(), status: "pending" })));
});

describe("contacts book", () => {
  const c = (uid, o = {}) => ({ name: "Ana Silva", organisation: "British Embassy", jobTitle: "Liaison", email: "ana@example.pt", phone: "+351 1", country: "Portugal", notes: "", createdBy: uid, createdByName: "X", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...o });
  beforeEach(() => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "contacts", "c1"), { ...c("alice"), createdAt: 1, updatedAt: 1 })));
  it("C1 anyone verified searches and adds; unverified cannot", async () => {
    await assertSucceeds(getDocs(collection(outsider(), "contacts")));
    await assertFails(getDocs(collection(unverified(), "contacts")));
    await assertSucceeds(addDoc(collection(outsider(), "contacts"), c("eve")));
    await assertFails(addDoc(collection(outsider(), "contacts"), c("alice")));
    await assertFails(addDoc(collection(outsider(), "contacts"), c("eve", { email: "not-an-email" })));
    await assertFails(addDoc(collection(outsider(), "contacts"), c("eve", { salary: 1 })));
  });
  it("C2 anyone verified edits (not the creator field); only HOST deletes", async () => {
    await assertSucceeds(updateDoc(doc(leader(), "contacts", "c1"), { phone: "+351 2", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(outsider(), "contacts", "c1"), { jobTitle: "Consul", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(unverified(), "contacts", "c1"), { phone: "+351 9", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(leader(), "contacts", "c1"), { phone: "x".repeat(41), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(member(), "contacts", "c1"), { phone: "+351 2", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(host(), "contacts", "c1"), { phone: "+351 3", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(host(), "contacts", "c1"), { createdBy: "host", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(member(), "contacts", "c1")));
    await assertSucceeds(deleteDoc(doc(host(), "contacts", "c1")));
  });
  it("C3 trip contacts: members link; other trips' members cannot", async () => {
    const link = (uid) => ({ name: "Ana Silva", organisation: "British Embassy", jobTitle: "", email: "ana@example.pt", phone: "", country: "Portugal", tripRole: "Embassy liaison", addedBy: uid, addedByName: "X", addedAt: serverTimestamp() });
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "contacts", "c1"), link("alice")));
    await assertFails(setDoc(doc(as("bob"), "trips", TRIP, "contacts", "c1"), link("bob")));
    await assertFails(getDocs(collection(as("bob"), "trips", TRIP, "contacts")));
    await assertSucceeds(deleteDoc(doc(leader(), "trips", TRIP, "contacts", "c1")));
  });
});

describe("controllers and the directory", () => {
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const ctl = () => as("ctl", { controller: true });
  beforeEach(() => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "trips", "liveSoon"), { ...tripDoc(["alice"]), startDate: iso(3), endDate: iso(6) });
    await setDoc(doc(db, "trips", "farOff"), { ...tripDoc(["alice"]), startDate: iso(40), endDate: iso(45) });
    await setDoc(doc(db, "trips", "closed"), { ...tripDoc(["alice"]), startDate: iso(-3), endDate: iso(-1), status: "archived" });
    await setDoc(doc(db, "trips", "liveSoon", "messages", "m1"), { senderUid: "alice", text: "hi" });
  }));
  it("D1 controllers read live trips and their messages, and post there", async () => {
    await assertSucceeds(getDoc(doc(ctl(), "trips", "liveSoon")));
    await assertSucceeds(getDocs(collection(ctl(), "trips", "liveSoon", "messages")));
    await assertSucceeds(addDoc(collection(ctl(), "trips", "liveSoon", "messages"), { senderUid: "ctl", senderName: "C", text: "Checking in", createdAt: serverTimestamp() }));
  });
  it("D2 controllers cannot see trips outside the live window, archived trips, or planning data", async () => {
    await assertFails(getDoc(doc(ctl(), "trips", "farOff")));
    await assertFails(getDoc(doc(ctl(), "trips", "closed")));
    await assertFails(getDocs(collection(ctl(), "trips", "farOff", "messages")));
    await assertFails(getDocs(collection(ctl(), "trips", "liveSoon", "flights")));
    await assertFails(getDocs(collection(ctl(), "trips")));
  });
  it("D3 non-members (no role) never see a trip, live or not", async () => {
    await assertFails(getDoc(doc(outsider(), "trips", "liveSoon")));
    await assertFails(getDocs(collection(outsider(), "trips", "liveSoon", "messages")));
  });
  it("D4 directory: everyone verified searches; each writes only their own entry, with their own email", async () => {
    await assertSucceeds(setDoc(doc(member(), "directory", "alice"), { name: "Alice", email: "alice@x.com", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(member(), "directory", "alice"), { name: "Alice", email: "boss@x.com", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(member(), "directory", "eve"), { name: "Eve", email: "alice@x.com", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as("bob"), "directory", "bob"), { name: "Bob", email: "bob@x.com", spc: true, updatedAt: serverTimestamp() }));
    await assertSucceeds(getDocs(collection(outsider(), "directory")));
    await assertFails(getDocs(collection(unverified(), "directory")));
  });
  it("D5 access lists stay functions-only", async () => {
    const ed = (uid, o) => ({ ...o, updatedAt: serverTimestamp(), updatedBy: uid, updatedByName: uid });
    await assertFails(updateDoc(doc(member(), "trips", TRIP), ed("alice", { extraAccessUids: ["eve"] })));
    await assertFails(updateDoc(doc(host(), "trips", TRIP), ed("host", { memberUids: ["eve"] })));
  });
});

describe("SPC role profile", () => {
  const decide = (uid) => ({ status: "approved", decidedBy: uid, decidedByName: "x", decidedAt: serverTimestamp() });
  it("P1 an SPC-profile holder on the trip authorises though not its named SPC", async () => {
    const alicePlusSpc = as("alice", { spc: true });
    await assertSucceeds(updateDoc(doc(alicePlusSpc, "trips", TRIP, "tlRequests", "q1"), decide("alice")));
  });
  it("P2 an SPC-profile holder NOT on the trip cannot see or authorise", async () => {
    const outsiderSpc = as("eve", { spc: true });
    await assertFails(getDoc(doc(outsiderSpc, "trips", TRIP)));
    await assertFails(updateDoc(doc(outsiderSpc, "trips", TRIP, "tlRequests", "q1"), decide("eve")));
  });
  it("P3 without the profile, a member who isn't the named SPC still cannot", () =>
    assertFails(updateDoc(doc(member(), "trips", TRIP, "tlRequests", "q1"), decide("alice"))));
});

describe("notifications and push tokens", () => {
  beforeEach(() => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users", "alice", "notifications", "n1"), { type: "message", title: "t", body: "b", read: false })));
  it("N1 own inbox: read, mark read, clear; nobody writes notifications from a client", async () => {
    await assertSucceeds(getDocs(collection(member(), "users", "alice", "notifications")));
    await assertSucceeds(updateDoc(doc(member(), "users", "alice", "notifications", "n1"), { read: true }));
    await assertFails(updateDoc(doc(member(), "users", "alice", "notifications", "n1"), { title: "forged" }));
    await assertFails(setDoc(doc(member(), "users", "alice", "notifications", "n2"), { type: "message", title: "x", body: "y", read: false }));
    await assertFails(getDocs(collection(leader(), "users", "alice", "notifications")));
    await assertFails(setDoc(doc(leader(), "users", "alice", "notifications", "n3"), { type: "message", title: "x", body: "y", read: false }));
    await assertSucceeds(deleteDoc(doc(member(), "users", "alice", "notifications", "n1")));
  });
  it("N2 push tokens: only your own", async () => {
    await assertSucceeds(setDoc(doc(member(), "users", "alice", "pushTokens", "d1"), { token: "tok", platform: "Android", updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(leader(), "users", "alice", "pushTokens", "d2"), { token: "tok", platform: "x", updatedAt: serverTimestamp() }));
    await assertFails(getDocs(collection(leader(), "users", "alice", "pushTokens")));
  });
  it("N3 a flight edit can only name the editor as updatedBy", async () => {
    const f = { flightNumber: "X1", from: "A", to: "B", createdBy: "alice", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(addDoc(collection(member(), "trips", TRIP, "flights"), { ...f, updatedBy: "alice" }));
    await assertFails(addDoc(collection(member(), "trips", TRIP, "flights"), { ...f, updatedBy: "lead" }));
  });
});

describe("request deletion", () => {
  it("16b creator withdraws while pending; afterwards only the SPC deletes (not HOST)", async () => {
    await assertFails(deleteDoc(doc(host(), "trips", TRIP, "tlRequests", "q1")));
    await assertFails(deleteDoc(doc(leader(), "trips", TRIP, "tlRequests", "q1")));
    await assertSucceeds(deleteDoc(doc(member(), "trips", TRIP, "tlRequests", "q1")));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "trips", TRIP, "tlRequests", "q2"), { kind: "cash", title: "x", createdBy: "alice", status: "approved" }));
    await assertFails(deleteDoc(doc(member(), "trips", TRIP, "tlRequests", "q2")));
    await assertSucceeds(deleteDoc(doc(spc(), "trips", TRIP, "tlRequests", "q2")));
  });
});

describe("vaccinations, debrief, finance, agreements", () => {
  it("17 declarations: own and the Team Leader/HOST read; other members cannot", async () => {
    await assertSucceeds(getDoc(doc(member(), "trips", TRIP, "vaccinations", "alice")));
    await assertSucceeds(getDoc(doc(leader(), "trips", TRIP, "vaccinations", "alice")));
    await assertSucceeds(getDocs(collection(host(), "trips", TRIP, "vaccinations")));
    const carol = as("carol");
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "trips", TRIP), { memberUids: ["alice", "lead", "carol"] }));
    await assertFails(getDoc(doc(carol, "trips", TRIP, "vaccinations", "alice")));
    await assertFails(getDocs(collection(carol, "trips", TRIP, "vaccinations")));
  });
  it("18 declare only your own, stamped by the server", async () => {
    await assertSucceeds(setDoc(doc(leader(), "trips", TRIP, "vaccinations", "lead"), { name: "L", vaccines: [{ name: "Rabies", date: "" }], notes: "", declared: true, declaredAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(leader(), "trips", TRIP, "vaccinations", "alice"), { name: "A", vaccines: [], notes: "", declared: true, declaredAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(outsider(), "trips", TRIP, "vaccinations", "eve"), { name: "E", vaccines: [], notes: "", declared: false, updatedAt: serverTimestamp() }));
  });
  it("19 debrief written by members with server time", async () => {
    const d = { wentWell: "x", couldBeBetter: "", welfareConcerns: "", injuryRefs: ["IR1"], reciprocityIssues: true, reciprocityDescription: "y", updatedByUid: "alice", updatedByName: "A", updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "debrief", "current"), d));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "debrief", "other"), d));
    await assertFails(setDoc(doc(outsider(), "trips", TRIP, "debrief", "current"), { ...d, updatedByUid: "eve" }));
  });
  it("20 finance: everyone reads, owner edits, HOST corrects without changing owner", async () => {
    const e = (owner) => ({ ownerUid: owner, ownerName: "A", date: "", category: "Fuel", description: "Fuel", amount: 12.5, currency: "GBP", paymentMethod: "", receiptRef: "", updatedAt: serverTimestamp() });
    await assertSucceeds(getDocs(collection(leader(), "trips", TRIP, "financeEntries")));
    await assertFails(getDocs(collection(outsider(), "trips", TRIP, "financeEntries")));
    await assertSucceeds(setDoc(doc(member(), "trips", TRIP, "financeEntries", "f1"), e("alice")));
    await assertFails(setDoc(doc(leader(), "trips", TRIP, "financeEntries", "f1"), e("alice")));
    await assertFails(setDoc(doc(member(), "trips", TRIP, "financeEntries", "f1"), e("lead")));
    await assertSucceeds(setDoc(doc(host(), "trips", TRIP, "financeEntries", "f1"), e("alice")));
    await assertFails(addDoc(collection(leader(), "trips", TRIP, "financeEntries"), e("alice")));
  });
  it("21 agreement records cannot be written or forged by a client", async () => {
    await assertFails(setDoc(doc(member(), "users", "alice", "agreements", "a1"), { termsVersion: "x" }));
    await assertSucceeds(getDocs(collection(member(), "users", "alice", "agreements")));
    await assertFails(getDocs(collection(outsider(), "users", "alice", "agreements")));
    await assertFails(setDoc(doc(member(), "users", "alice"), { name: "A", termsVersion: "x" }));
    await assertSucceeds(setDoc(doc(unverified(), "users", "alice"), { name: "A", email: "alice@x.com", createdAt: serverTimestamp() }));
  });
  it("22 functions-only collections are closed", async () => {
    await assertFails(getDoc(doc(member(), "passkeys", "k")));
    await assertFails(setDoc(doc(member(), "rateLimits", "r"), { count: 0 }));
  });
});
