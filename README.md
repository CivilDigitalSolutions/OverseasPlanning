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

## AWS / Laravel backend (in progress)

The app is moving to Laravel + Sanctum on AWS under UK Secure by Design:
[`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) · [`docs/SECURITY-PLAN.md`](docs/SECURITY-PLAN.md) ·
[`docs/DEPLOY-AWS.md`](docs/DEPLOY-AWS.md) · open questions [`docs/AWS-SECURITY.md`](docs/AWS-SECURITY.md) ·
testing [`docs/security/TESTING.md`](docs/security/TESTING.md) · report [`docs/security/REPORT.md`](docs/security/REPORT.md).

```bash
cd api && composer install && cp .env.example .env && php artisan key:generate   # PostgreSQL in .env
php artisan migrate && php artisan voyager:make-admin you@example.org --host
php artisan serve                                  # API on :8000
cd web && npm run dev:aws                          # PWA on :5173, /api proxied to :8000
cd api && php artisan test                         # 42 tests, needs the voyager_test database
scripts/security/all.sh                            # tests, audits, Semgrep, Larastan
```

## Client demo on GitHub Pages

**https://civildigitalsolutions.github.io/OverseasPlanning/** — published by
`.github/workflows/pages.yml` on every push to the working branch (or `main`) that touches `web/`,
and on demand from the repository's Actions tab ("pages-demo" → Run workflow).

- It is the same app with every screen, running **entirely in the visitor's browser**: no Firebase,
  no server, no real data. Each visitor signs up with any name and email (confirmation is simulated)
  and their trips, attachments (IndexedDB) and settings stay in that browser only. Clear the site's
  data in the browser to start again.
- The yellow strip at the top lets one person try every role (HOST, Controller, SPC,
  Administrator). Sample teams T101–T105 are created on first use.
- PDF export and attachment downloads use the browser's normal download.
- The page asks search engines not to index it, but the URL itself is public: anyone with the
  link can open the demo. Never enter real trip or personal data into it.
- Build locally: `cd web && npm run build:pages` → `web/dist-pages/`.

## Demo build (claude.ai artifact)

`cd web && npm run build:demo` builds `web/dist-demo/index.html`: the same screens with the
Firebase modules swapped for `web/src/demo/*` (shared artifact database, simulated email links
and biometrics, no security rules). For trying the app only — never for real trip data.
`node web/scripts/demo-artifact.mjs web/dist-demo/index.html <out.html>` makes the artifact page.
