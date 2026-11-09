# Setup (owner steps)

1. **Firebase project** — create one (Blaze plan for Functions), then set its id in `.firebaserc`.
   Choose `europe-west2` (London) for Firestore and Storage if UK residency matters
   (functions region is in `functions/src/lib/config.ts`).
2. **Auth** — enable *Email/Password*. Templates → set the **Action URL** to
   `https://<your-domain>/auth/action` so verification and reset links land in the app.
   Add your domain to *Authorized domains*.
3. **Web app** — register a Web app, copy `web/.env.example` to `web/.env.local` and fill in
   `VITE_FB_*`. The build refuses to run without them.
4. **Passkeys** — create `functions/.env.<project-id>`:
   ```
   PASSKEY_RP_ID=<your-domain>
   PASSKEY_ORIGINS=https://<your-domain>
   ```
5. **Deploy** — `firebase deploy --only firestore,storage,functions` then
   `npm --prefix web run build && firebase deploy --only hosting`.
   Custom-token sign-in (passkeys) needs the functions service account to have
   *Service Account Token Creator* on itself.
6. **First admin / HOST** — sign up in the app, confirm the email, then
   `GOOGLE_CLOUD_PROJECT=<id> node functions/scripts/grant-admin.js you@example.com --host`
   and sign out and in. Further HOST members are granted from Account → HOST team.
7. **Terms and Privacy** — write the text in `web/src/Legal.tsx` and bump
   `TERMS_VERSION` / `PRIVACY_VERSION` in `web/src/model.ts`.
