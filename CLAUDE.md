# CLAUDE.md — Overseas Planning

Spec: `docs/SPEC.md` (read the relevant section first; update it in the same change when behaviour
or the data model changes; TODO(owner) sections are decisions still to be made — leave them blank
rather than inventing answers). Setup: `docs/SETUP.md`.

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

## Commands
```
cd web && npm test && npm run build
cd functions && npm test
firebase emulators:exec --only firestore "npm --prefix functions run test:rules"
```
