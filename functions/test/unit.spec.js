const assert = require("node:assert/strict");
const { cleanRoles, cleanRisk, cleanEmail, isDocId, cleanText } = require("../lib/lib/validate");

describe("validate", () => {
  it("emails", () => {
    assert.equal(cleanEmail(" Jane@X.com "), "jane@x.com");
    assert.equal(cleanEmail("nope"), null);
  });
  it("roles: known keys only, valid emails, blank skipped, name defaults", () => {
    assert.deepEqual(cleanRoles({ teamLeader: { name: "", email: "a@b.co" }, spc: { name: "", email: "" } }).roles, { teamLeader: { name: "a", email: "a@b.co" } });
    assert.ok(cleanRoles({ boss: { name: "x", email: "a@b.co" } }).error);
    assert.ok(cleanRoles({ spc: { name: "x", email: "bad" } }).error);
    assert.equal(cleanRoles(undefined).error, null);
  });
  it("risk needs a known level and a rationale", () => {
    assert.deepEqual(cleanRisk("High", " why ", "cyber"), { level: "High", rationale: "why" });
    assert.throws(() => cleanRisk("Extreme", "x", "cyber"));
    assert.throws(() => cleanRisk("Low", "  ", "cyber"));
  });
  it("doc ids and text", () => {
    assert.ok(isDocId("abc_DEF-1"));
    assert.ok(!isDocId("a/b"));
    assert.ok(!isDocId("__x__"));
    assert.equal(cleanText("a\u0000b", 10), "ab");
  });
});

const { computeAccess } = require("../lib/lib/membership");
const { isLiveTrip } = require("../lib/lib/live");

describe("trip membership", () => {
  const base = {
    requester: { uid: "req", name: "Rae", email: "rae@x.com" },
    roles: {
      teamLeader: { name: "Tia", email: "tia@x.com", uid: "tl" },
      spc: { name: "Sam", email: "sam@x.com", uid: null },
      intelWorker: { name: "Rae", email: "rae@x.com", uid: "req" },
    },
    passengers: [{ flight: "TP1351", name: "Pat", uid: "pat" }, { flight: "TP1351", name: "Tia", uid: "tl" }, { flight: "TP1351", name: "No account" }],
    extraUids: [{ uid: "obs", name: "Ola", email: "ola@x.com" }],
    extraEmails: ["new@x.com"],
  };
  it("members = requester + role holders + flight passengers + additional access, with reasons", () => {
    const r = computeAccess(base);
    assert.deepEqual(r.memberUids, ["obs", "pat", "req", "tl"]);
    assert.deepEqual(r.members.tl.reasons, ["Team Leader", "On flight TP1351"]);
    assert.deepEqual(r.members.req.reasons, ["Requester", "Intel Worker"]);
    assert.deepEqual(r.members.obs.reasons, ["Additional access"]);
    assert.deepEqual(r.pendingEmails, ["new@x.com", "sam@x.com"]);
  });
  it("someone taken off every source loses access", () => {
    const r = computeAccess({ ...base, passengers: [], extraUids: [] });
    assert.equal(r.memberUids.includes("pat"), false);
    assert.equal(r.memberUids.includes("obs"), false);
  });
});

describe("live window", () => {
  const now = Date.parse("2026-11-10T09:00:00Z");
  it("not archived and starting within 10 days or already started, or marked live", () => {
    assert.equal(isLiveTrip({ status: "planning", startDate: "2026-11-20" }, now), true);
    assert.equal(isLiveTrip({ status: "planning", startDate: "2026-11-21" }, now), false);
    assert.equal(isLiveTrip({ status: "planning", startDate: "2026-10-01" }, now), true);
    assert.equal(isLiveTrip({ status: "archived", startDate: "2026-11-11" }, now), false);
    assert.equal(isLiveTrip({ status: "live", startDate: "2027-05-01" }, now), true);
  });
});
