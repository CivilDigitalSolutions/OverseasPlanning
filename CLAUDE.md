# CLAUDE.md — Voyager Trip Manager (repo: OverseasPlanning)

Spec: `docs/SPEC.md` (read the relevant section first; update it in the same change when behaviour
or the data model changes; TODO(owner) sections are decisions still to be made — leave them blank
rather than inventing answers). Setup: `docs/SETUP.md`. Planned AWS/Laravel move, security
assurance decisions and open AWS questions: `docs/AWS-SECURITY.md`.

## Rules
1. Never weaken `firestore.rules` / `storage.rules` to make a feature work; fix the data model or
   add a Cloud Function. Every rules change needs tests in `functions/test/` incl. a cross-trip denial.
2. Trip access comes only from `trips/{id}.memberUids` (functions-written) or the `host` claim.
3. Roles (`host`, `admin`) are custom claims set only by functions/scripts.
4. Agreement records (`users/{uid}/agreements`) are functions-only and append-only.
5. No emulator connections in app code; emulators are for automated tests only.
6. UI: minimal descriptive text — a label header per input with hint text inside the input.
7. All Firebase access goes through `web/src/store.ts`; pure logic lives in `web/src/model.ts`
   (unit-tested with `node --test`). Keep `ITEM_SCHEMAS` and the rules' `itemKeys` in step.

## Laravel / AWS backend (api/, being built to replace Firebase — docs/MIGRATION-PLAN.md)
8. Every trip-scoped endpoint resolves the trip through `App\Services\TripAccess::need*()` (Semgrep
   rule enforces it); `trip_members` is written ONLY by `App\Services\Membership`.
9. Role profiles change only through the administrator endpoints or `voyager:make-admin`
   (never mass-assignable); audit tables are append-only (DB triggers) and have no foreign keys.
10. Any access-control change needs feature tests in `api/tests/`, including a cross-trip denial.
11. `web/src/api/store.ts` must keep the same exports as `web/src/store.ts` (`api/conformance.ts`
    fails the build otherwise). No trip data in browser storage.
12. Security testing: `docs/security/TESTING.md`; results go into `docs/security/REPORT.md`.

## Commands
```
cd web && npm test && npm run build
cd functions && npm test
firebase emulators:exec --only firestore "npm --prefix functions run test:rules"
cd api && php artisan test                 # needs PostgreSQL (phpunit.xml: voyager_test)
cd web && npm run build:aws                # PWA for the Laravel API
scripts/security/all.sh                    # tests + audits + SAST
```
