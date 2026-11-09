/** Storage rules. Run: firebase emulators:exec --only firestore,storage "npm --prefix functions run test:storage" */
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, setDoc } = require("firebase/firestore");
const { ref, uploadBytes, getBytes } = require("firebase/storage");

let env;
const root = path.join(__dirname, "..", "..");
const as = (uid, claims = {}) => env.authenticatedContext(uid, { email: `${uid}@x.com`, email_verified: true, ...claims }).storage();
const bytes = new Uint8Array([1, 2, 3]);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-overseas",
    firestore: { rules: fs.readFileSync(path.join(root, "firestore.rules"), "utf8") },
    storage: { rules: fs.readFileSync(path.join(root, "storage.rules"), "utf8") },
  });
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "trips", "t1"), { memberUids: ["alice"] }));
});
after(() => env.cleanup());

describe("storage", () => {
  const p = "trips/t1/attachments/a1/doc.pdf";
  it("S1 a member uploads as themselves; others cannot", async () => {
    await assertSucceeds(uploadBytes(ref(as("alice"), p), bytes, { customMetadata: { uploadedBy: "alice" } }));
    await assertFails(uploadBytes(ref(as("eve"), "trips/t1/attachments/a2/x.pdf"), bytes, { customMetadata: { uploadedBy: "eve" } }));
    await assertFails(uploadBytes(ref(as("alice"), "trips/t1/attachments/a3/x.pdf"), bytes, { customMetadata: { uploadedBy: "bob" } }));
  });
  it("S2 members and HOST read; outsiders cannot", async () => {
    await assertSucceeds(getBytes(ref(as("alice"), p)));
    await assertSucceeds(getBytes(ref(as("h", { host: true }), p)));
    await assertFails(getBytes(ref(as("eve"), p)));
  });
  it("S3 nothing outside trips/ is writable", () => assertFails(uploadBytes(ref(as("alice"), "public/x"), bytes)));
});
