# Voyager Trip Manager — migration plan: Firebase → Laravel on AWS

Status: **draft for owner review (2026-11-11)**. Security design, threat model, testing and the
risk register are in `docs/SECURITY-PLAN.md`. Owner decisions and open AWS questions are in
`docs/AWS-SECURITY.md`. Items marked **TODO(owner)** wait for an owner decision; nothing is invented.

## 1. Goal

Run the same app (same screens, same rules about who sees what) on the organisation's AWS
account, with a Laravel + Sanctum backend in place of Firebase, delivered as a PWA, assured under
UK Government Secure by Design.

What does NOT change: every screen, the PWA shell, the domain logic in `web/src/model.ts`, the
access model (who is on a trip and why), the approval workflows and the owner decisions in
`docs/SPEC.md`.

## 2. Target architecture

```
 Browser / installed PWA
        │ HTTPS (one origin, e.g. https://voyager.<org-domain>)
        ▼
 Zscaler (ZPA for internal access; ZIA if exposed externally)       TODO(owner) — AWS-SECURITY.md Q8
        ▼
 Application Load Balancer + AWS WAF (managed rules, rate rules)     private (internal) by default
        ▼
 ECS Fargate service: one container = nginx (serves the built PWA, security headers)
                                      + PHP-FPM (Laravel API under /api)            private subnets
        │                 │                     │                  │
        ▼                 ▼                     ▼                  ▼
 RDS PostgreSQL      S3 bucket             SES (email)        CloudWatch Logs
 (KMS, Multi-AZ,     (attachments,         via VPC endpoint   → organisation SIEM
  backups)            private, KMS)                             (TODO(owner) Q6)
 Secrets Manager → APP_KEY, DB password, VAPID private key (injected as container secrets)
```

Why one origin: Sanctum's SPA mode uses an HttpOnly session cookie plus CSRF token, which only
works cleanly when the PWA and API share an origin. It also removes CORS entirely and keeps every
request on one domain for Zscaler to categorise.

Choices that depend on the AWS baseline (all TODO(owner), `AWS-SECURITY.md`): account/region
(eu-west-2 assumed for UK data), Fargate vs EC2, CMK vs AWS-managed keys, log destination, and
whether sign-in must federate to the organisation's identity provider.

## 3. Component mapping

| Firebase today | Laravel / AWS | Notes |
|---|---|---|
| Firebase Auth (email+password) | Own small auth controller on Laravel's session guard + Sanctum SPA (no Fortify: fewer routes, fewer dependencies) | Password ≥ 10 chars + breached-password check |
| Email verification / reset links | Laravel signed verification URLs, password broker tokens; mail via SES | Links land on the PWA's `/auth/action` screen |
| Passkeys (custom WebAuthn → custom token) | WebAuthn verified in Laravel, then a normal session | RP ID becomes the new domain: passkeys must be re-registered |
| Custom claims host/controller/spc/admin | `users.is_host / is_controller / is_spc / is_admin`, written only by admin endpoints | Every change logged in `role_changes` |
| Firestore rules | Policies + one `TripAccess` service; every endpoint authorises server-side | Same tests ported, incl. cross-trip denial |
| `memberUids` recomputed by functions | `trip_members` recomputed by `App\Services\Membership` (port of `computeAccess`) | Same reasons: Requester, roles, "On flight …", Additional access |
| Firestore collections | PostgreSQL tables (section 4) | Server stamps every author and time |
| Realtime listeners (`onSnapshot`) | Polling: messages 5 s, notifications 15 s, everything else 20 s; only while the app is visible; identical requests shared between screens; stops on 403/404 | Zscaler-safe; websockets (Reverb) can come later |
| Offline Firestore cache | **Not carried over** (see §7, owner decision) | |
| Cloud Storage | S3, private; uploads AND downloads stream through the API after an access check | Keeps one origin (no browser access to S3), works through ZPA |
| Cloud Functions triggers | Synchronous service calls + queued jobs | Notification fan-out is a queued job |
| FCM web push | Standard Web Push (VAPID) via `minishlink/web-push` | Browser push services must be reachable through Zscaler |
| `rateLimits` collection | Laravel rate limiters (database/cache) | |
| `roleChanges`, `agreements` | Append-only tables, protected by DB triggers | |

## 4. Data model (PostgreSQL)

All ids are ULIDs (no guessable sequences). All tables carry `created_at`/`updated_at` set by the
server. Health and welfare text is encrypted at the application layer.

| Table | Key columns |
|---|---|
| `users` | name, email, email_verified_at, password, is_host, is_controller, is_spc, is_admin, last_agreement_at, terms_version, privacy_version, disabled_at |
| `agreements` | user_id (no foreign key, so the record outlives a deleted account), terms_version, privacy_version, method, email, ip, user_agent, accepted_at — **append-only** |
| `role_changes` | user_id, email, changes (json), by_user_id (no foreign keys) — **append-only** |
| `passkeys` | user_id, credential_id, public_key, counter, transports, label, last_used_at |
| `trip_requests` | team_name, start_date, end_date, location, requester_id, status, decline_reason, trip_id, decided_by |
| `trips` | name, team_name, location, start/end_date, status, cyber/country risk + rationale, dip_*, roles (jsonb: role → name, email, user id), extra_access_uids / extra_access_emails (jsonb), requester_id, created_by (+name/email), updated_by (+name) |
| `trip_members` | trip_id, user_id, name, email, reasons (json), added_at — **written only by `App\Services\Membership`** |
| `trip_pending_emails` | trip_id, email — invitations waiting for that address to be confirmed (also Membership-only) |
| `trip_items` | trip_id, kind (flights/hotels/cars/assets), values (jsonb, validated per `ITEM_SCHEMAS`), spc_decision, spc_rationale, spc_decided_by(+name/at), created_by(+name), updated_by |
| `messages` | trip_id, sender_id, sender_name, text |
| `attachments` | trip_id, name, s3_key, size, content_type, uploaded_by(+name) |
| `tl_requests` | trip_id, kind, title, details, quantity, amount, currency, needed_by, status, created_by(+name), decided_by(+name/at), decision_note |
| `summaries` | trip_id, role (teamLeader/spc), text, by_user_id, by_name |
| `contacts` / `trip_contacts` | global book / per-trip copy with trip_role |
| `vaccinations` | trip_id, user_id, name, vaccines (**encrypted**), notes (**encrypted**), declared, declared_at |
| `debriefs` | trip_id, went_well, could_be_better, welfare_concerns (**encrypted**), injury_refs (**encrypted**), reciprocity_*, updated_by |
| `finance_entries` / `finance_notes` | per traveller |
| `trip_reads` | user_id, trip_id, read_at |
| `app_notifications` | user_id, type, title, body, trip_id, link, read (60-day prune: `voyager:prune`) |
| `push_subscriptions` | user_id, endpoint, keys, user_agent |
| `audit_logs` | actor_id, method, route, trip_id, status, ip, user_agent, request_id |
| `security_events` | user_id, type, detail, ip, action_taken |

## 5. API

REST under `/api/v1`, JSON only, session-cookie authenticated (Sanctum SPA), CSRF on every write.
Endpoints mirror the functions in `web/src/store.ts` one for one, so the screens do not change: the
PWA is built with `VITE_BACKEND=laravel`, which swaps `store.ts`, `Auth.tsx`, `passkeys.ts` and the
Firebase imports for `web/src/api/*` (the same technique the demo build already uses). Firebase
stays buildable until cut-over, then is deleted.

## 6. Phases

| # | Phase | Exit criteria |
|---|---|---|
| 0 | Owner decisions + AWS baseline (`AWS-SECURITY.md` TODOs) | Baseline document received; SRO named |
| 1 | Laravel API at feature parity, with tests | All access tests (incl. cross-trip denial) pass |
| 2 | PWA client for the API (`VITE_BACKEND=laravel`) | Every screen works against the API locally |
| 3 | Security testing (SECURITY-PLAN §6) and remediation | No open High/Critical; risk register signed |
| 4 | AWS build to the baseline (infrastructure as code) | Baseline controls evidenced |
| 5 | Data migration (if Firebase holds live data) and cut-over | Counts reconciled; users re-set passwords and passkeys |
| 6 | Decommission Firebase project | Firebase data deleted; keys revoked |

This change delivers phases 1 and 2 plus the tooling for phase 3. Phases 0, 4, 5 and 6 need the
owner and the AWS baseline.

## 7. Behaviour that changes (owner to confirm)

1. **Offline reading.** Firestore cached the last-opened trip on the phone. The API version does
   not cache trip data on the device by default: an offline copy of personal and health data on a
   lost phone is a real risk. TODO(owner): accept "online only", or allow an encrypted, time-limited
   offline copy of a trip.
2. **Real time.** Updates arrive by polling (seconds, not instantly).
3. **Existing passwords and passkeys** cannot be moved: Firebase password hashes are not portable
   to Laravel, and passkeys are tied to the old domain. Everyone sets a new password via an emailed
   link and re-adds passkeys.
4. **Push notifications carry no trip detail.** FCM pushes included the message text; web push
   goes through Google/Apple/Mozilla servers, so a push now says only "New message" / "Added to a
   trip" / "Booked on a flight". The in-app inbox keeps the full text.
5. **Sign-in and agreement are one step.** The server refuses a sign-in that does not carry the
   terms/privacy agreement, and records it in the same transaction (Firebase did it as a second
   call that could fail after sign-in).

## 8. Data migration (phase 5)

Only needed if the Firebase project holds real data. Approach: Firestore export to a private
bucket, a one-off `php artisan voyager:import-firestore <export.json>` mapping documents to the
tables in §4, with counts reconciled per collection, then the export deleted. User accounts are
created without a usable password and sent a set-password link. Attachments copied object-by-object to S3.
Not built until the owner confirms there is data to move.

## 9. Plan review (2026-11-11)

The first draft was reviewed for consistency, flaws and logic errors before building. Findings
and how the plan now handles them:

| # | Finding | Resolution |
|---|---|---|
| 1 | Zscaler sends many users from a few egress IPs (ZPA: the connector's IP), so per-IP login limits and a WAF IP rule could lock out whole offices. | Limits keyed on email/user; IP ceilings set high (SECURITY-PLAN T1, R14). |
| 2 | Background polling would keep every session alive for ever, so an idle timeout would never fire on a lost phone. | Polls carry `X-Background-Poll: 1` and do not refresh the idle clock; absolute lifetime added. |
| 3 | S3 presigned download links break the one-origin design, need S3 reachable through Zscaler, and work for anyone holding the link for 5 minutes. | Files stream through the API after an access check. |
| 4 | Append-only tables with foreign keys to `users` would make account deletion fail (or force an UPDATE the trigger forbids). | Audit tables keep ids and an email snapshot with no foreign keys. |
| 5 | Polling a trip after losing access produces a stream of 403s that the anomaly detector would read as an attack and, in protect mode, lock the person out. | Detector counts distinct refused resources; client stops polling on 403/404; higher thresholds for HOST/controllers. |
| 6 | Push notifications previously carried message text; web push passes through vendor servers outside AWS. | Generic push text; detail stays in the in-app inbox (§7 item 4). |
| 7 | "Laravel LTS" — Laravel has no LTS releases. | Use a major version inside its security-support window and plan upgrades. |
| 8 | Fortify adds routes and views the PWA does not use. | Small own auth controller on Laravel's built-in session guard, password broker and signed URLs. |
| 9 | ~15 hooks polling separately on the trip screen would multiply requests per user. | One shared polling cache: identical URLs fetched once, paused when hidden. |
| 10 | Strict CSP vs React inline `style` attributes. | `script-src 'self'` stays strict; `style-src` allows inline styles (low risk), noted in the report. |
| 11 | `X-Forwarded-For` trusted from anywhere would let attackers dodge limits and forge log IPs. | Trust only the load balancer. |
| 12 | Field encryption with one key has no rotation story. | `APP_PREVIOUS_KEYS` rotation; runbook in phase 4 (R15). |
| 13 | Email verification links in Laravel normally need the user to be signed in; people open them on another device. | The signed URL itself is the proof; verification works signed out. |
