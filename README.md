# Voyager Trip Manager

(Repository: OverseasPlanning.) 
Installable web app (PWA) for requesting, planning, running and debriefing overseas trips.
React + Vite + TypeScript on Firebase (Auth, Firestore, Storage, Cloud Functions).

- Spec: [`docs/SPEC.md`](docs/SPEC.md) · Setup: [`docs/SETUP.md`](docs/SETUP.md)

```bash
cd web && npm install && npm run dev       # http://localhost:5173 (needs web/.env.local)
cd web && npm test && npm run build
cd functions && npm install && npm test
firebase emulators:exec --only firestore "npm --prefix functions run test:rules"
firebase emulators:exec --only firestore,storage "npm --prefix functions run test:storage"
```

## Demo build (claude.ai artifact)

`cd web && npm run build:demo` builds `web/dist-demo/index.html`: the same screens with the
Firebase modules swapped for `web/src/demo/*` (shared artifact database, simulated email links
and biometrics, no security rules). For trying the app only — never for real trip data.
`node web/scripts/demo-artifact.mjs web/dist-demo/index.html <out.html>` makes the artifact page.
