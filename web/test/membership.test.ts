import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccess } from "../src/membership.ts";

test("trip members = requester + roles + flight passengers + additional access; removal drops access", () => {
  const input = {
    requester: { uid: "req", name: "Rae", email: "rae@x.com" },
    roles: { teamLeader: { name: "Tia", email: "tia@x.com", uid: "tl" }, spc: { name: "Sam", email: "sam@x.com", uid: null } },
    passengers: [{ flight: "TP1351", name: "Pat", uid: "pat" }, { flight: "TP1351", name: "Walk-in" }],
    extraUids: [{ uid: "obs", name: "Ola", email: "ola@x.com" }],
    extraEmails: ["new@x.com"],
  };
  const r = computeAccess(input);
  assert.deepEqual(r.memberUids, ["obs", "pat", "req", "tl"]);
  assert.deepEqual(r.members.pat.reasons, ["On flight TP1351"]);
  assert.deepEqual(r.pendingEmails, ["new@x.com", "sam@x.com"]);
  assert.equal(computeAccess({ ...input, passengers: [] }).memberUids.includes("pat"), false);
});
