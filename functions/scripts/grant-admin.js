// Bootstrap the first admin (who can then grant HOST in the app's Account page).
// Usage (with Application Default Credentials for the project):
//   GOOGLE_CLOUD_PROJECT=<project-id> node functions/scripts/grant-admin.js someone@example.com [--host]
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

(async () => {
  const email = process.argv[2];
  if (!email) { console.error("Usage: node grant-admin.js <email> [--host]"); process.exit(2); }
  initializeApp();
  const user = await getAuth().getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}), admin: true, ...(process.argv.includes("--host") ? { host: true } : {}) };
  await getAuth().setCustomUserClaims(user.uid, claims);
  console.log(`Granted ${JSON.stringify(claims)} to ${email} (${user.uid}). They must sign out and in again.`);
})().catch((e) => { console.error(e); process.exit(1); });
