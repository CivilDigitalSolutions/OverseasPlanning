# Overseas Planning — Specification

Status: **first build (2026-11-09)**. Sections marked **TODO(owner)** are deliberately left blank or
provisional: they need a decision the build could not make.

## 1. Purpose

A mobile-first, installable web app (PWA) to request, plan, run and debrief overseas trips.

## 2. Accounts and sign-in

- Email + password sign-up and sign-in (Firebase Auth). Password ≥ 10 characters.
- **Email must be confirmed** before anything else is reachable (verification gate). Firebase
  sends the verification email; the link lands on `/auth/action`.
- **Password reset** from the sign-in screen and the Account page (same answer whether or not the
  account exists).
- **Passkeys**: fingerprint, face recognition (Face ID / Android face unlock), Windows Hello or a
  security key, via WebAuthn. Added from Account → "Fingerprint, face & passkeys"; used from the
  sign-in screen. Verified server-side (`functions/src/passkeys.ts`, ported from TrackLink),
  user verification required. Needs `PASSKEY_RP_ID` / `PASSKEY_ORIGINS` set to the hosted domain.
- **Terms + privacy agreement on every sign-in**: the sign-in and sign-up forms require ticking
  "I agree to the Terms and Privacy Policy". Each sign-in (password, passkey, sign-up) calls
  `recordAgreement`, which writes an append-only record to `users/{uid}/agreements/{id}`:
  versions, method, email, IP, user agent, server time. If the record cannot be written the person
  is signed out again.
- Roles: **HOST** (triage team) and **admin** are custom claims. The first admin is created with
  `functions/scripts/grant-admin.js`; admins grant HOST from the Account page (`setHostRole`).

### 2a. Terms of Use — TODO(owner)
### 2b. Privacy Policy — TODO(owner)
### 2c. Account deletion / data export for individuals — TODO(owner)

## 3. Trip lifecycle

1. **Request** — anyone signed in submits: team name, departure date, return date, location.
2. **Triage (HOST)** — HOST sees requests awaiting triage, then either declines (with a reason
   shown to the requester) or **creates the trip** on one screen:
   - Cyber risk (drop-down) + rationale; Country risk (drop-down) + rationale.
   - Basic roles: **Team Leader, Office Manager, SPC, Intel Worker** (name + email each).
   - The trip records the HOST member who created it (`createdByName`, `createdByEmail`), shown on
     the Overview as "Created by (HOST)" and in the PDF.
3. **Planning → Live → Archived** — status is set by HOST or the trip's Team Leader. A hint
   appears when the dates say it should move; it is never changed automatically.
4. Lists: **Planning**, **Live trips**, **Archived**. Planning and Archived are the same view;
   Archived adds a search (every word must match: name, team, location, dates, risk, role holders).

Access: the requester, every role holder with a confirmed account, and anyone added through
**Access** see the trip. HOST sees every trip.

- Risk scale: provisional **Low / Medium / High / Critical**. **TODO(owner): confirm the scale**
  (also in `firestore.rules`).
- Who may edit risk after creation: HOST only (provisional).

## 4. Data model (Firestore)

```
users/{uid}                         name, email, createdAt; lastAgreementAt/termsVersion/privacyVersion (functions)
users/{uid}/agreements/{id}         functions-only, append-only agreement records
users/{uid}/tripReads/{tripId}      readAt (unread line in messages)
tripRequests/{id}                   teamName, startDate, endDate, location, requester*, status submitted|accepted|declined, tripId, declineReason
trips/{tripId}                      name, teamName, location, startDate, endDate, status planning|live|archived,
                                    cyberRisk, cyberRationale, countryRisk, countryRationale,
                                    roles{teamLeader|officeManager|spc|intelWorker: {name,email,uid}},
                                    memberUids[] (functions-only), pendingEmails[] (functions-only), requestId
  members/{uid}                     name, email, addedByName, addedAt (functions-only)
  flights|hotels|cars|assets/{id}   fields per web/src/model.ts ITEM_SCHEMAS + createdBy/At, updatedAt
  messages/{id}                     senderUid, senderName, text, createdAt
  attachments/{id}                  name, path (Storage), size, contentType, uploadedBy, createdAt
  tlRequests/{id}                   kind, title, details, quantity, amount, currency, neededBy, status, decision*, completion*
  vaccinations/{uid}                vaccines[{name,date}], notes, declared, declaredAt
  debrief/current                   wentWell, couldBeBetter, welfareConcerns, injuryRefs[], reciprocityIssues, reciprocityDescription
  financeEntries/{id}               ownerUid, date, category, description, amount, currency, paymentMethod, receiptRef
  financeNotes/{uid}                text (each traveller's own trip record)
passkeys/{credentialId}, passkeyChallenges/{id}, rateLimits/{id}, roleChanges/{id}   functions-only
```

Storage: `trips/{tripId}/attachments/{attId}/{fileName}` (≤ 25 MB, members only).

## 5. Planning tabs

Single trip screen with tab navigation: Overview · Flights · Hotels · Hire cars · Assets ·
Requests · Messages · Attachments · Vaccinations · Access · Debrief, plus **PDF export**.

- **Flights**: airline, flight number, from, to, departs, arrives, booking ref, **cost of booking**
  (amount + currency), **named persons**, notes.
- **Hotels**: name, address, city, phone, check-in/out, booking ref, **cost of booking**,
  **named persons**, notes.
- **Hire cars** (owner, 2026-11-10): **hire car company**, vehicle, **insurance class**,
  registration, **collection location + date**, **drop-off location + date** (not before
  collection), booking ref, **cost of booking**, named drivers, notes.
- Named persons are added one name at a time, with quick-picks from the trip's role holders and
  people with access; stored as a list of names. Costs are stored as `cost` (number) +
  `costCurrency`; the rules refuse a cost without a currency.
- **Assets** (taken overseas): asset, category, serial/asset number, quantity, carried by,
  returned after the trip, notes.
- **TODO(owner): confirm the field lists** (keep `ITEM_SCHEMAS` and the rules' `itemKeys` in step).

### 5a. Integrations (booking systems, travel agency) — TODO(owner)
### 5b. Travel advice / country risk sources — TODO(owner)

## 6. Collaboration

- **Messages**: one live chat per trip, laid out like TrackLink's messages (day pills, runs,
  unread line, sending tick, Enter to send, delete your own). Messages stay with the trip.
  - TODO(owner): message retention, attachments inside messages, push notifications.
- **Attachments**: upload any file ≤ 25 MB; download; uploader or HOST deletes.
- **Access**: anyone with access adds people by email; unknown emails wait as "pending sign-up"
  and are granted when that person confirms their email (`syncPendingAccess`). HOST removes.
- **Requests to the Team Leader, with approval**:
  - Types: **Resource (people), Flight, Hotel, Hire car, Asset, Cash** (cash adds amount +
    currency; people/assets add quantity; all have needed-by and details).
  - Workflow: **Awaiting approval → Approved / Rejected → Completed**. **Only the trip's SPC
    approves or rejects** (with a note) — not HOST, not the Team Leader (owner decision
    2026-11-10; enforced in `firestore.rules` `isSpc`). The SPC also marks an
    approved request completed (with an outcome).
  - **Update 2026-11-10: every step is authorised by the SPC only** — approve, reject and mark
    completed. The person who raised a request may withdraw (delete) it while it awaits approval;
    after that only the SPC can delete it. HOST and the Team Leader have no request authority.
    The requester may resubmit a rejected request. Each request is listed individually with a
    status badge; the tab shows a count of open items (awaiting approval or approved-not-done).
  - TODO(owner): may the SPC approve their own request? Who approves when the trip has no SPC
    with an account yet (today: nobody)? Approval limits for cash? Should an
    approved flight/hotel/car/asset automatically create the planning item?
- **Export**: "PDF" on the trip header exports every section (overview, roles, access, flights,
  hotels, cars, assets, requests + decisions, vaccination declarations the exporter may read,
  attachment list, debrief, financial debrief, messages) client-side with jsPDF.
  - TODO(owner): protective marking / classification banner on exports; include attachment files?

## 7. Debrief

- **Trip debrief**: what went well; what could be done better; welfare concerns; third-party
  injury report system reference numbers (one per line); **reciprocity issues** checkbox with a
  description box.
- **Financial debrief**: each traveller adds and edits their own finance items (date, category,
  description, amount, currency, paid by, receipt reference) and a free-text trip record.
  Everyone on the trip sees all items and per-person totals by currency; HOST may correct an item.
  - TODO(owner): categories, approval/sign-off of claims, budget vs actual, cost codes, export to
    the finance system, receipts as attachments.

## 8. Vaccination declarations

Each traveller records vaccinations (name + date) and notes, then ticks the declaration. The
Team Leader and HOST see everyone's status (Declared / Draft / Missing) and details; others see
only their own.

- TODO(owner): required vaccinations per country; declaration wording (`DECLARATION_TEXT`);
  who may read (health data — DPIA); retention; how "travelling" differs from "has access".

## 9. Notifications — TODO(owner)

## 10. Offline and installation

- PWA: manifest, icons, service worker (app shell only — trip data is not cached by the service
  worker; Firestore's own offline cache keeps the last-read trip available).
- Install prompt on mobile: Android/Chrome shows **Install**; iOS Safari shows "Share → Add to
  Home Screen". "Not now" hides it for 14 days.

## 11. UI principles

- As little descriptive text as possible: each input has a label header and hint text inside the
  input (placeholder). Badges and icons carry status.

## 12. Security

- Rules: `firestore.rules`, `storage.rules`; tests in `functions/test/` (Firestore 22 passing).
- Trip access only from `memberUids` (functions-written) or the HOST claim; confirmed email
  required everywhere except the user's own profile and agreement records.
- TODO(owner): App Check, audit log of who viewed what, data residency confirmation, DPIA.

## 13. Hosting, domains, environments — TODO(owner)
