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
- Role profiles are custom claims: **HOST** (triage team), **Controller** (live trips), **SPC** and
  **Administrator** (`admin`).
- **SPC role profile** (owner, 2026-11-10): an SPC-profile holder **authorises requests and flight
  approvals on any trip they can see**, whether or not they are that trip's named SPC (rules
  `isSpc`: named SPC OR spc claim + on the trip). The SPC picker on Create trip / Edit roles lists
  only SPC-profile holders (flag mirrored on their directory entry by functions). TODO(owner):
  should SPC-profile holders see every trip (today they see only trips they're on, or all if HOST)? The first administrator is created with
  `functions/scripts/grant-admin.js`.
- **Account manager** (owner, 2026-11-10): administrators open it from the **settings cog** in the
  top bar. They search all accounts, **create** an account (name, email, role profiles — the
  server creates it without a password and returns a set-password link to send; TODO(owner): send
  it by branded email), **change role profiles** (HOST / Controller / Administrator, saved on tick)
  and **delete** an account (removed from every trip's roles, flights and additional access, the
  directory and their passkeys; agreement records and requests are kept for the audit trail).
  An administrator cannot remove their own Administrator permission or delete themselves.
  Callables: `listAccounts`, `createAccount`, `setAccountRoles`, `deleteAccount` (admin only).

### 2a. Terms of Use — TODO(owner)
### 2b. Privacy Policy — TODO(owner)
### 2c. Account deletion / data export for individuals — TODO(owner)

## 3. Trip lifecycle

1. **Request** — anyone signed in submits: team name, departure date, return date, location.
2. **Triage (HOST)** — HOST sees requests awaiting triage, then either declines (with a reason
   shown to the requester) or **creates the trip** on one screen:
   - Cyber risk (drop-down) + rationale; Country risk (drop-down) + rationale.
   - Basic roles: **Team Leader, Office Manager, SPC, Intel Worker** (name + email each).
   - **Everyone on the trip edits the Overview** (owner, 2026-11-10): risk levels and rationales,
     roles (incl. HOST assessment name/email), trip name, team, location, dates, DiP classification
     and DiP Agreed — each section has its own Edit button. Every edit is stamped with who made it
     and when (`updatedBy`, `updatedByName`, `updatedAt`; rules require `updatedBy` = the editor) and
     shown as "Last edited by …". Moving the trip between Planning/Live/Archived stays with HOST and
     the Team Leader. Roles still change through `updateTripRoles` (now open to anyone on the trip)
     because it grants access to the people named.
   - **DiP classification** (owner, 2026-11-10): a drop-down — **PSA, CP, Reece, Event** (or not
     set) — in the Overview's Trip section and the PDF; editable by anyone on the trip
     (`trips.dipClassification`, values checked in rules `validDip`).
   - **DiP Agreed** (owner, 2026-11-10): a checkbox and the date the DiP was agreed, in the
     Overview's Trip section and the PDF. Anyone on the trip sets it; an agreed DiP must carry a date (`trips.dipAgreed`,
     `trips.dipAgreedDate`, rules `validDip`).
   - The trip records the HOST member who created it (`createdByName`, `createdByEmail`), shown on
     the Overview's **Roles** section as "HOST assessment" (first row) and in the PDF's Roles table.
3. **Planning → Live → Archived** — status is set by HOST or the trip's Team Leader. A hint
   appears when the dates say it should move; it is never changed automatically.
4. **My requests** (non-HOST) lists your own requests awaiting triage or declined, and a request
   that became a trip only while you're **directly** part of that trip (role, flight or additional
   access) — not merely as its requester (owner, 2026-11-10).
4. Lists: **Planning**, **Live trips**, **Archived**. Planning and Archived are the same view;
   Archived adds a search (every word must match: name, team, location, dates, risk, role holders).
5. **Live trips** (owner, 2026-11-10) is a date window, not a status: every trip that is **not
   archived** and **starts within the next 10 days or has already started** (so trips under way,
   or finished but not formally closed by archiving, stay listed), plus any trip marked Live.
   Each row shows where the trip is ("Starts in 3 days", "Day 2 of 5", "Ended 4 days ago — not
   archived"). Opening one shows **only the basic details** (location, dates, team, role holders,
   risk levels) **and the team messages**; planning is done from the full trip screen.
   A trip can therefore appear in both Planning and Live trips while it is close to departure.

Access (owner decision 2026-11-10): **a trip is visible only to the people on it** —
the **requester**, everyone named in a **role**, everyone **booked on a flight**, and anyone given
**additional access** — plus the whole **HOST team** (sees every trip) and **controllers** (see
every *live* trip's basic details and team messages, and can post there; nothing else).
- `trips.memberUids` is worked out by Cloud Functions from those sources
  (`functions/src/lib/membership.ts`, mirrored in `web/src/membership.ts`) after every change:
  trip creation, role edits, additional access added/removed, a pending email signing up, and any
  change to who is booked on a flight (`onFlightWritten` trigger). Someone taken off a role or a
  flight therefore **loses access** unless they're still on the trip another way. The Access tab
  shows each person's reasons ("Requester", "Team Leader", "On flight TP1351", "Additional access").
- Additional access is kept in `extraAccessUids` / `extraAccessEmails`; HOST removes it. Older
  trips without those fields keep everyone they had as additional access.
- **In-app directory** (`directory/{uid}`: name + sign-in email, each person writes only their own,
  everyone signed in can search it): people pickers for flight passengers, roles and Access.
- **Controller** is a role profile (custom claim, granted by an administrator). Controllers get the
  live list from `listLiveTrips` (basic details only) and the rules let them read a live trip and
  read/post its messages; never planning tabs or trips outside the live window.

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

Single trip screen with tab navigation: Overview · Requests · Flights · Hotels · Hire cars ·
Assets · Messages · Attachments · Vaccinations · Contacts · Access · Debrief, plus **PDF export**.

- **Flights** (owner, 2026-11-10):
  - **Flight status**: Planning / Requested / Confirmed. **Flight type**: Outbound / Inbound /
    Onward / Connecting. Airline, **flight number**, booking ref, **flight cost** (+ currency).
  - **Departure airport + local date & time**; **arrival airport + local date & time** (not before
    departure).
  - **Day or night flight**: filled in automatically from the local times — Night when it departs
    19:00–05:59 or lands on a later date (overnight), otherwise Day — and can be changed.
    Definition confirmed by the owner (2026-11-10).
  - **Flight duration**: typed ("7h 30m", "7:30" or minutes), stored in minutes. Not calculated:
    local times at each end are in different time zones.
  - **Booked with corporate travel services?** Yes/No. **Have you considered booking options to
    achieve best value for money?** Yes/No (asked of the person entering the flight). Both required.
  - **People booked**, each under a **class**: First class, Business class, Premium economy,
    Economy, Charter flight, Other; shown grouped by class.
  - **SPC approval**: only the trip's SPC records *Approved* or *Not approved*, with a required
    free-text rationale (who, when and why are stored: `spcDecision`, `spcRationale`,
    `spcDecidedBy/Name/At`). **Editing a decided flight clears the decision**, so a changed flight
    is approved again (enforced in `firestore.rules`).
  - **Flight policy**: a book icon ("Flight policy") at the top of the Flights tab and in the flight
    form opens the policy. TODO(owner): PLACEHOLDER text in `web/src/flightPolicy.ts`.
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
  - Types: **Resource (people), Flight, Hotel, Hire car, Taxi, Asset, Cash** (cash adds amount +
    currency; people/assets add quantity; all have needed-by and a free-text **Rationale**,
    which replaces the earlier "Details" box — confirmed by the owner 2026-11-10).
  - At the top of the Requests tab: a **Team Leader summary** and an **SPC summary**, free text,
    **editable by anyone on the trip** (owner, 2026-11-10), each showing who saved it last and when
    (`trips/{id}/summaries/{teamLeader|spc}`).
  - (2026-11-10: "the SPC" below means the trip's named SPC **or anyone with the SPC role profile**.)
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

### 6a. Contacts book (owner, 2026-11-10)

- A **global contacts book** (`contacts/{id}`: name, organisation, job title, email, phone, country,
  notes). Everyone signed in (confirmed email) can search it, add to it and **edit any entry**
  (owner, 2026-11-10); only HOST deletes one. **Duplicates are not merged**: entries with the same
  name stay separate.
- Each trip has a **Contacts** tab: search the book (every word across name, organisation, title,
  email, phone, country), add a contact with their **role on this trip**, or create a new contact
  (saved to the book and added to the trip). The trip keeps its own copy
  (`trips/{id}/contacts/{contactId}`) so its record and PDF stand on their own; the tab shows the
  book's current details where available.
- TODO(owner): a search index if the book grows past a few thousand entries (search is in the
  browser today).

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

## 9. Notifications (owner, 2026-11-10)

People are told when they are **added to a trip**, **booked on a flight** (one notification —
"booked on a flight" covers being added to the trip by it) and when a **new message** arrives on a
trip they are on (never about their own action). Server: `functions/src/lib/notify.ts`, called from
the membership recompute, `onFlightWritten` and `onMessageCreated`.
- **In-app inbox** `users/{uid}/notifications` (60-day TTL): bell with unread count in the top bar,
  a Notifications page (tap to open the trip; mark all read; clear), and a pop-up banner for
  anything arriving while the app is open. Works everywhere, including the claude.ai demo.
- **Push** (Firebase Cloud Messaging web push): Account → "Notifications on this device" → Turn on
  stores the device token in `users/{uid}/pushTokens`; the service worker (`web/src/sw.ts`) shows the
  notification and opens the link when tapped. Dead tokens are pruned. **iPhone: web push needs the
  app added to the Home Screen** (iOS 16.4+). The artifact demo can't receive push.
- TODO(owner): notifications for request approvals/decisions, per-type mute, quiet hours.

## 10. Offline and installation

- PWA: manifest, icons, service worker (app shell only — trip data is not cached by the service
  worker; Firestore's own offline cache keeps the last-read trip available).
- Install prompt on mobile: Android/Chrome shows **Install**; iOS Safari shows "Share → Add to
  Home Screen". "Not now" hides it for 14 days.

## 11. UI principles

- As little descriptive text as possible: each input has a label header and hint text inside the
  input (placeholder). Badges and icons carry status.
- **Phone keyboard** (owner, 2026-11-10): tapping any text box on a phone scrolls it to sit just
  above the on-screen keyboard (with its label), on pages, in pop-up forms and in the message box
  (`web/src/keyboard.ts`; pop-ups size themselves to the area above the keyboard; Android is also
  told to resize the page with `interactive-widget=resizes-content`).

## 12. Security

- Rules: `firestore.rules`, `storage.rules`; tests in `functions/test/` (Firestore 22 passing).
- Trip access only from `memberUids` (functions-written) or the HOST claim; confirmed email
  required everywhere except the user's own profile and agreement records.
- TODO(owner): App Check, audit log of who viewed what, data residency confirmation, DPIA.

## 13. Hosting, domains, environments — TODO(owner)
