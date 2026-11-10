import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_SCHEMAS, addPerson, byClass, dayNightFor, formatDuration, parseDuration, cleanInjuryRefs, displayValue, cleanItem, cleanVaccines, financeTotals, firstUnreadIndex, openCount, parseAmount, safeFileName,
  sortTlRequests, startsRun, statusHint, tripMatches, tripsFor, validateRequest, validateTlRequest,
  type ChatMessage, type FinanceEntry, type TlRequest, type Trip,
} from "../src/model.ts";

const trip = (o: Partial<Trip>): Trip => ({
  id: "t", name: "", teamName: "Alpha", location: "Paris, France", startDate: "2026-05-01", endDate: "2026-05-07", status: "planning",
  cyberRisk: "Low", cyberRationale: "", countryRisk: "Medium", countryRationale: "", roles: {}, memberUids: [], pendingEmails: [],
  requestId: null, createdByName: "", createdByEmail: "", dipAgreed: false, dipAgreedDate: "", dipClassification: "", createdAtMs: 0, ...o,
});

test("request validation", () => {
  assert.deepEqual(validateRequest({ teamName: "A", startDate: "2026-01-01", endDate: "2026-01-02", location: "X" }), {});
  const e = validateRequest({ teamName: " ", startDate: "2026-01-05", endDate: "2026-01-02", location: "" });
  assert.ok(e.teamName && e.location && e.endDate);
  assert.ok(validateRequest({ teamName: "A", startDate: "nope", endDate: "2026-01-02", location: "X" }).startDate);
});

test("archived search matches every word, any order, across roles", () => {
  const t = trip({ roles: { teamLeader: { name: "Jane Smith", email: "jane@x.com" } } });
  assert.ok(tripMatches(t, "france smith"));
  assert.ok(tripMatches(t, "  "));
  assert.ok(!tripMatches(t, "germany"));
});

test("tripsFor filters by status and orders archive newest first", () => {
  const list = [trip({ id: "a", status: "archived", startDate: "2025-01-01" }), trip({ id: "b", status: "archived", startDate: "2026-01-01" }), trip({ id: "c" })];
  assert.deepEqual(tripsFor(list, "archived").map((t) => t.id), ["b", "a"]);
  assert.deepEqual(tripsFor(list, "planning").map((t) => t.id), ["c"]);
});

test("status hints", () => {
  assert.ok(statusHint(trip({}), "2026-05-01"));
  assert.equal(statusHint(trip({}), "2026-04-30"), null);
  assert.ok(statusHint(trip({ status: "live" }), "2026-05-08"));
});

test("cleanItem: required, lists, numbers, checkbox", () => {
  const r = cleanItem(ITEM_SCHEMAS.hotels, { name: "H", guests: ["A", "", " B "] });
  assert.deepEqual(r.value.guests, ["A", "B"]);
  assert.ok(cleanItem(ITEM_SCHEMAS.flights, { flightNumber: "BA1", from: "LHR", to: "" }).errors.to);
  const a = cleanItem(ITEM_SCHEMAS.assets, { name: "Laptop", quantity: "2", returned: true });
  assert.deepEqual(a.errors, {});
  assert.equal(a.value.quantity, 2);
  assert.equal(a.value.returned, true);
  assert.ok(cleanItem(ITEM_SCHEMAS.assets, { name: "x", quantity: "1.5" }).errors.quantity);
});

const req = (o: Partial<TlRequest>): TlRequest => ({
  id: "r", kind: "flight", title: "t", details: "", quantity: null, amount: null, currency: "", neededBy: "", createdBy: "u",
  createdByName: "", createdAtMs: 0, status: "pending", decidedByName: "", decidedAtMs: 0, decisionNote: "", completedByName: "",
  completedAtMs: 0, response: "", ...o,
});

test("TL request validation by kind", () => {
  assert.deepEqual(validateTlRequest({ kind: "flight", title: "x", quantity: "", amount: "", currency: "" }), {});
  assert.ok(validateTlRequest({ kind: "cash", title: "x", quantity: "", amount: "", currency: "GBP" }).amount);
  assert.deepEqual(validateTlRequest({ kind: "cash", title: "x", quantity: "", amount: "£1,250.50", currency: "GBP" }), {});
  assert.ok(validateTlRequest({ kind: "resource", title: "x", quantity: "0", amount: "", currency: "" }).quantity);
  assert.ok(validateTlRequest({ kind: "bogus", title: "x", quantity: "", amount: "", currency: "" }).kind);
});

test("requests order: pending, approved, rejected, completed; open count", () => {
  const rs = [req({ id: "c", status: "completed" }), req({ id: "p2", createdAtMs: 2 }), req({ id: "a", status: "approved" }), req({ id: "p1", createdAtMs: 1 }), req({ id: "x", status: "rejected" })];
  assert.deepEqual(sortTlRequests(rs).map((r) => r.id), ["p1", "p2", "a", "x", "c"]);
  assert.equal(openCount(rs), 3);
});

test("amounts and finance totals per person per currency", () => {
  assert.equal(parseAmount("£1,200.555"), 1200.56);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("-1"), null);
  const e = (ownerUid: string, amount: number, currency: string) => ({ ownerUid, amount, currency }) as FinanceEntry;
  assert.deepEqual(financeTotals([e("a", 1.1, "GBP"), e("a", 2.2, "GBP"), e("a", 5, "EUR"), e("b", 1, "GBP")]),
    { a: { GBP: 3.3, EUR: 5 }, b: { GBP: 1 } });
});

test("injury refs and vaccines are cleaned", () => {
  assert.deepEqual(cleanInjuryRefs("IR-1\nIR-2, IR-1\n\n"), ["IR-1", "IR-2"]);
  assert.deepEqual(cleanVaccines([{ name: " Yellow fever ", date: "2025-01-01" }, { name: "", date: "" }, { name: "Rabies", date: "bad" }]),
    [{ name: "Yellow fever", date: "2025-01-01" }, { name: "Rabies", date: "" }]);
});

test("chat runs and unread line", () => {
  const m = (id: string, senderUid: string, createdAtMs: number) => ({ id, senderUid, senderName: "", text: "", createdAtMs, pending: false }) as ChatMessage;
  const now = Date.UTC(2026, 0, 1, 12);
  const ms = [m("1", "a", now), m("2", "a", now + 60_000), m("3", "b", now + 120_000), m("4", "a", now + 20 * 60_000)];
  assert.equal(startsRun(undefined, ms[0]), true);
  assert.equal(startsRun(ms[0], ms[1]), false);
  assert.equal(startsRun(ms[1], ms[2]), true);
  assert.equal(startsRun(ms[3 - 1], ms[3]), true);
  assert.equal(firstUnreadIndex(ms, now + 30_000, "a"), 2);
});

test("safe file names", () => {
  assert.equal(safeFileName("../../etc/passwd"), ".._.._etc_passwd");
  assert.equal(safeFileName("Itinerary (final).pdf"), "Itinerary _final_.pdf");
  assert.equal(safeFileName("///"), "_");
});

test("booking cost: amount + currency, defaulting to GBP; bad amounts refused", () => {
  const h = cleanItem(ITEM_SCHEMAS.hotels, { name: "H", cost: "£1,240.5" });
  assert.deepEqual([h.value.cost, h.value.costCurrency], [1240.5, "GBP"]);
  const f = cleanItem(ITEM_SCHEMAS.flights, { flightStatus: "Planning", flightType: "Outbound", corporateTravel: "Yes", valueForMoney: "No", flightNumber: "X1", from: "A", to: "B", cost: "300", costCurrency: "EUR" });
  assert.equal(f.value.costCurrency, "EUR");
  assert.ok(cleanItem(ITEM_SCHEMAS.cars, { company: "Hertz", cost: "lots" }).errors.cost);
  assert.equal("costCurrency" in cleanItem(ITEM_SCHEMAS.cars, { company: "Hertz" }).value, false);
  assert.equal(displayValue(ITEM_SCHEMAS.hotels.fields.find((x) => x.key === "cost")!, h.value), "£1,240.50");
});

test("hire car: collection/drop-off dates in order", () => {
  const ok = cleanItem(ITEM_SCHEMAS.cars, { company: "Hertz", insuranceClass: "Group C", collectionDate: "2026-12-01", dropOffDate: "2026-12-08" });
  assert.deepEqual(ok.errors, {});
  assert.ok(cleanItem(ITEM_SCHEMAS.cars, { company: "Hertz", collectionDate: "2026-12-08", dropOffDate: "2026-12-01" }).errors.dropOffDate);
  assert.ok(cleanItem(ITEM_SCHEMAS.hotels, { name: "H", checkIn: "2026-12-08", checkOut: "2026-12-01" }).errors.checkOut);
});

test("named persons: trimmed, no duplicates, capped", () => {
  assert.deepEqual(addPerson(["Jane Smith"], "  jane   smith "), ["Jane Smith"]);
  assert.deepEqual(addPerson(["A"], " Alex  Brown "), ["A", "Alex Brown"]);
  assert.deepEqual(addPerson(["A"], "   "), ["A"]);
  assert.deepEqual(addPerson(["A", "B"], "C", 2), ["A", "B"]);
});

const goodFlight = { flightStatus: "Requested", flightType: "Inbound", flightNumber: "TP1350", from: "LIS", to: "LHR", corporateTravel: "Yes", valueForMoney: "Yes" };

test("flight: status, type, corporate travel and value-for-money are required choices", () => {
  assert.deepEqual(cleanItem(ITEM_SCHEMAS.flights, goodFlight).errors, {});
  const e = cleanItem(ITEM_SCHEMAS.flights, { flightNumber: "X", from: "A", to: "B", flightStatus: "Booked" }).errors;
  assert.ok(e.flightStatus && e.flightType && e.corporateTravel && e.valueForMoney);
  assert.ok(cleanItem(ITEM_SCHEMAS.flights, { ...goodFlight, departAt: "2026-12-02T10:00", arriveAt: "2026-12-01T10:00" }).errors.arriveAt);
});

test("flight: passengers need a class each, grouped by class", () => {
  const ok = cleanItem(ITEM_SCHEMAS.flights, { ...goodFlight, passengers: [{ name: " Jane ", travelClass: "Business class" }, { name: "Alex", travelClass: "First class" }, { name: "", travelClass: "Other" }] });
  assert.deepEqual(ok.value.passengers, [{ name: "Jane", travelClass: "Business class" }, { name: "Alex", travelClass: "First class" }]);
  assert.ok(cleanItem(ITEM_SCHEMAS.flights, { ...goodFlight, passengers: [{ name: "Jane", travelClass: "" }] }).errors.passengers);
  assert.deepEqual(byClass(ok.value.passengers as never).map((g) => g.travelClass), ["First class", "Business class"]);
});

test("day or night from local times", () => {
  assert.equal(dayNightFor("2026-12-01T07:10", "2026-12-01T09:55"), "Day");
  assert.equal(dayNightFor("2026-12-01T21:30", "2026-12-01T23:50"), "Night");
  assert.equal(dayNightFor("2026-12-01T05:00", ""), "Night");
  assert.equal(dayNightFor("2026-12-01T16:00", "2026-12-02T07:00"), "Night");
  assert.equal(dayNightFor("", "2026-12-02T07:00"), "");
});

test("duration parsing and display", () => {
  assert.equal(parseDuration("7h 30m"), 450);
  assert.equal(parseDuration("7:05"), 425);
  assert.equal(parseDuration("45m"), 45);
  assert.equal(parseDuration("2 hours"), 120);
  assert.equal(parseDuration("165"), 165);
  assert.equal(parseDuration("soon"), null);
  assert.equal(parseDuration("99h"), null);
  assert.equal(formatDuration(450), "7h 30m");
  assert.equal(cleanItem(ITEM_SCHEMAS.flights, { ...goodFlight, durationMinutes: "2h 45m" }).value.durationMinutes, 165);
});

test("display: text is shown exactly; only date-times lose their T", () => {
  const fn = ITEM_SCHEMAS.flights.fields.find((x) => x.key === "flightNumber")!;
  const dep = ITEM_SCHEMAS.flights.fields.find((x) => x.key === "departAt")!;
  assert.equal(displayValue(fn, { flightNumber: "TP1351" }), "TP1351");
  assert.equal(displayValue(dep, { departAt: "2026-12-01T21:10" }), "2026-12-01 21:10");
});
