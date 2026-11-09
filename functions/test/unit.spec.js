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
