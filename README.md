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

## Demo build (claude.ai artifact)

`cd web && npm run build:demo` builds `web/dist-demo/index.html`: the same screens with the
Firebase modules swapped for `web/src/demo/*` (shared artifact database, simulated email links
and biometrics, no security rules). For trying the app only — never for real trip data.
`node web/scripts/demo-artifact.mjs web/dist-demo/index.html <out.html>` makes the artifact page.
