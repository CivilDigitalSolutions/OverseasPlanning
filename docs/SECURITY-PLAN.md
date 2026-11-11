# Voyager Trip Manager — security plan (Secure by Design)

Status: **draft for owner review (2026-11-11)**. Architecture: `docs/MIGRATION-PLAN.md`. Open AWS
and organisational questions: `docs/AWS-SECURITY.md`. **TODO(owner)** = decision still needed.

## 1. Framework

The app is assured under **UK Government Secure by Design**. Its principles are mapped to concrete
activities and evidence in §2; code-level requirements follow **OWASP ASVS 4.0 Level 2** (the
level for applications holding sensitive personal data). The app is a PWA, so mobile-specific
OWASP MASVS controls are applied only where they make sense for a browser app (§6.3).

## 2. Secure by Design principles → what we do → evidence

Check the wording against the current gov.uk Secure by Design guidance when the report is written.

| Principle | Activity in this project | Evidence for the report |
|---|---|---|
| Create responsibility for cyber security risk | Named Senior Responsible Owner and risk owner; risk appetite stated. TODO(owner) | Signed risk register (§8) |
| Source secure technology products | A Laravel major version inside its security-support window (Laravel has no LTS releases); dependencies pinned (`composer.lock`, `package-lock.json`); `composer audit` / `npm audit` on every build | Audit outputs; SBOM (`composer`/`npm` CycloneDX) |
| Adopt a risk-driven approach | Threat model (§3) drives controls (§4); risk register kept live | Threat model + register revisions |
| Design usable security controls | Passkeys (fingerprint/face) offered beside passwords; minimal-text UI; agreement captured as part of sign-in | Screens; usability notes |
| Build in detect and respond security | Audit log, security events, anomaly detection, alerts, incident procedure (§5) | Log samples, alert test, runbook |
| Design flexible architectures | Store seam (`web/src/store.ts` ↔ `web/src/api/store.ts`); stateless containers; infrastructure as code | Architecture doc, IaC |
| Minimise the attack surface | One origin, no CORS; API only under `/api/v1`; no public bucket; private subnets; internal ALB by default; no admin UI framework (Filament not used) | Endpoint inventory (`php artisan route:list`), network diagram |
| Defend in depth | WAF → rate limits → authentication → policies per record → field encryption → DB triggers for append-only tables → KMS at rest | Control list (§4) with test references |
| Embed continuous assurance | CI runs tests + SAST + dependency audit + secrets scan on every change; ZAP scan per release; annual pen test TODO(owner) | CI history; scan reports |
| Make changes securely | Branch → review → CI → deploy; migrations reviewed; rules/policy changes need access tests incl. cross-trip denial | Pull request history; test suite |

## 3. Threat model (STRIDE, summarised)

Assets, in order of harm if exposed: travellers' identities and itineraries (flights, hotels,
dates, locations) for deployments overseas; vaccination declarations and welfare/injury notes
(health data); risk assessments and DiP classifications; messages; finance records; accounts and
role profiles.

Actors: an outsider on the internet (if exposed); a signed-in user trying to see trips they are
not on; a user trying to raise their own role; a stolen or unlocked phone; a compromised
dependency; an insider with an administrator profile.

| # | Threat (STRIDE) | Example | Main controls |
|---|---|---|---|
| T1 | Spoofing | Password guessing / credential stuffing | Rate limits keyed on the **email** (Zscaler puts many users behind a few IPs, so IP-only limits would lock out whole offices), generous per-IP ceiling, breached-password check, passkeys, lockout alerts |
| T2 | Spoofing | Claiming a trip by registering with someone else's email | Access granted only to **verified** emails; pending emails resolve only after verification |
| T3 | Tampering | Editing a request decision or flight approval without the SPC profile | Server-side policy per action; client never sends who/when; tests |
| T4 | Tampering | Raising own role (mass assignment) | Role columns not fillable; only admin endpoints change them; self-demotion guard; `role_changes` log |
| T5 | Repudiation | "I never agreed to the terms" / "I didn't approve that" | Append-only `agreements`, `audit_logs`, decision fields stamped server-side; DB triggers block UPDATE/DELETE |
| T6 | Information disclosure | Reading another trip by changing an id (IDOR) | Every trip-scoped route resolves the trip and checks `TripAccess`; ULIDs; cross-trip denial tests for every resource |
| T7 | Information disclosure | Controller reads planning data of a live trip | Controller endpoints return basic details + messages only |
| T8 | Information disclosure | Health data leak (DB snapshot, logs) | Field encryption (APP_KEY in Secrets Manager); KMS at rest; logs never contain bodies |
| T9 | Information disclosure | Attachment link shared or guessed | Private S3, never reached by the browser; every download streams through the API after the access check |
| T10 | Information disclosure | Lost phone with the PWA open | Session idle timeout measured from the person's own actions (background polling does not keep a session alive); absolute session lifetime; sign-out clears caches; no API data in the service-worker cache |
| T11 | Denial of service | Flooding the API | WAF, per-route rate limits, request size limits, autoscaling caps |
| T12 | Elevation of privilege | XSS stealing a session | React escaping, strict CSP (no inline script), HttpOnly+Secure+SameSite cookies, Trusted Types later |
| T13 | Elevation of privilege | CSRF on a write | Sanctum CSRF token on every state-changing request; SameSite=Lax |
| T14 | Supply chain | Malicious package update | Lockfiles, audits, review of dependency changes, Semgrep secrets rules |
| T15 | Insider | Administrator abuses account manager | Every role change and account deletion logged; alerts on bulk changes; TODO(owner): two-person rule? |

## 4. Controls built into the API (ASVS L2 areas)

| Area | Control | Where |
|---|---|---|
| Authentication | Sanctum SPA session; password ≥ 10 chars + breached check; login 5/min per email+IP; email verification required for all trip data; passkeys via WebAuthn with user verification required | `api/app/Http/Controllers/AuthController.php`, `PasskeyController.php` |
| Session | HttpOnly, Secure, SameSite=Lax cookie in the database (shared by all containers); regenerated at login; idle timeout from the last *interactive* request (polls send `X-Background-Poll: 1` and do not count) — default 30 min, absolute 12 h, both TODO(owner); logout invalidates | `api/app/Http/Middleware/IdleTimeout.php` |
| Access control | `TripAccess` service is the only place that decides trip access; policies call it; default deny | `api/app/Services/TripAccess.php` |
| Validation | Every input validated server-side (lengths, enums, dates, item schemas ported from `ITEM_SCHEMAS`) | `api/app/Support/ItemSchemas.php`, form validation |
| Stored data | Server stamps authors and times; field encryption for health/welfare; ULIDs | Models |
| Files | ≤ 25 MB, stored under random keys, streamed through the API with `Content-Disposition: attachment` and `nosniff` | `AttachmentController` |
| Headers | CSP (`script-src 'self'`; `style-src 'self' 'unsafe-inline'` because React style attributes need it), HSTS, X-Content-Type-Options, frame-ancestors none, Referrer-Policy, Permissions-Policy, COOP/CORP | `SecurityHeaders` middleware + nginx |
| Errors | Generic messages to clients; detail only in logs; debug off in production | `bootstrap/app.php` |
| Logging | JSON logs with request id; audit log for every write and every sensitive read | `AuditTrail` middleware |
| Append-only | PostgreSQL triggers reject UPDATE/DELETE on `agreements`, `role_changes`, `audit_logs`; these tables have no foreign keys, so deleting an account never needs to touch them | migration |
| Proxies | Only the load balancer is a trusted proxy, so `X-Forwarded-For` cannot be forged to dodge limits or pollute logs | `bootstrap/app.php` (`TRUSTED_PROXIES`) |

## 5. Runtime protection (RASP) — PWA edition

True in-app RASP (root/jailbreak, tamper and hook detection) needs a native app; this is a PWA
(owner decision), so runtime protection lives on the server, in three layers:

1. **Edge:** AWS WAF managed rule groups (core rule set, known bad inputs, SQL injection, IP
   reputation) + rate-based rule; blocks logged.
2. **In-app self-protection** (`api/app/Security/`):
   - `RequestGuard` rejects oversized bodies, non-JSON writes, deeply nested JSON and null bytes
     before they reach a controller.
   - `AnomalyDetector` counts, per user and per 10 minutes, **distinct** resources refused (403/404)
     and distinct trips opened. Distinct, not raw, counts: a screen still polling a trip the person
     has just been removed from must not look like an attack (the client also stops polling on
     403/404). HOST and controllers have higher thresholds because they legitimately open many trips.
     Over the threshold it records a `security_event` and, in **protect** mode, ends the user's
     sessions and blocks the account until an administrator re-enables it. Mode and thresholds
     are configuration (`SECURITY_RASP_MODE=detect|protect`); start in `detect` during testing.
   - Failed logins, passkey failures, role changes and account deletions always raise events.
3. **Detect and respond:** security events and WAF blocks are shipped to CloudWatch (and the
   organisation SIEM, TODO(owner)) with alarms; GuardDuty on the account.

**Incident procedure (summary; full runbook in phase 4):** alert → triage within 1 working hour →
contain (block account via account manager, revoke sessions, WAF IP block) → preserve logs →
eradicate/recover → notify the data protection officer (personal data breach: ICO within 72 hours
if reportable) → lessons learned into the risk register.

## 6. Security testing

### 6.1 Tools (all free)

| Tool | What it tests | Command |
|---|---|---|
| PHPUnit feature tests | Access control incl. cross-trip denial, workflows | `cd api && php artisan test` |
| Larastan (PHPStan) | PHP type/logic errors | `cd api && vendor/bin/phpstan analyse` |
| Semgrep | SAST: PHP, Laravel, TypeScript/React, secrets | `scripts/security/semgrep.sh` |
| `composer audit`, `npm audit` | Known-vulnerable dependencies | `scripts/security/deps.sh` |
| Gitleaks | Secrets committed to git | `scripts/security/secrets.sh` |
| OWASP ZAP | DAST: baseline + full scan of a running instance | `scripts/security/zap.sh <url>` |
| Trivy | Container image + IaC misconfiguration | `scripts/security/trivy.sh` |

### 6.2 MobSF

MobSF analyses Android/iOS app packages. A PWA has none, so **MobSF is not applicable while the app
stays a PWA**; the report states this and relies on §6.1. If the app is later wrapped
(Capacitor/TWA), MobSF static and dynamic scans are added to the pipeline.

### 6.3 Mobile-relevant checks for a PWA (MASVS-inspired)

Storage: no tokens or trip data in localStorage/IndexedDB/service-worker cache (session cookie
only). Network: HTTPS only, HSTS, no mixed content. Platform: service worker scope limited;
manifest has no external origins. Privacy: push payloads carry no sensitive text beyond a title.
Each is a manual test case in the report.

### 6.4 Cadence

Every change: tests, Larastan, Semgrep, audits, Gitleaks (CI). Every release: ZAP full scan on a
staging stack, Trivy. Yearly or on major change: independent penetration test (TODO(owner)).

## 7. Zscaler

No certificate pinning; one first-party domain; no third-party CDNs or fonts; polling not
websockets; push needs the browser vendors' push endpoints allowed. TODO(owner): ZPA application
segment or ZIA URL category, and SSL-inspection policy for the domain.

## 8. Risk register (feeds the final report)

Status: **Mitigated** (control in place and tested), **Partially mitigated**, **Accepted** (owner
signs with reason), **Open**. Likelihood/impact on a 1–5 scale; the scale is a TODO(owner) to
align with the organisation's own.

| ID | Risk | L | I | Controls | Status | Owner |
|---|---|---|---|---|---|---|
| R1 | Unauthorised access to another trip (IDOR) | 3 | 5 | T6 controls + tests | Mitigated (on test pass) | Dev |
| R2 | Account takeover by password attack | 3 | 4 | T1 controls | Mitigated | Dev |
| R3 | Health data exposure | 2 | 5 | T8 controls | Mitigated | Dev |
| R4 | Privilege escalation via roles | 2 | 5 | T4 controls | Mitigated | Dev |
| R5 | Lost/stolen phone with open session | 3 | 4 | Idle timeout, no offline data | Partially mitigated — MDM unknown (AWS-SECURITY Q9) | TODO(owner) |
| R6 | No on-device RASP (PWA) | 2 | 3 | Server-side RASP (§5) | Accepted? TODO(owner) | TODO(owner) |
| R7 | MobSF not applicable (PWA) | — | — | §6.1 tools instead | Accepted? TODO(owner) | TODO(owner) |
| R8 | Push via browser vendor services (data leaves AWS) | 2 | 2 | Payload is a generic title only — no trip, person or message text | Partially mitigated | TODO(owner) |
| R9 | Breached-password check calls an external API | 2 | 1 | k-anonymity (only 5 hash chars sent); fails open if blocked by Zscaler | Accepted? TODO(owner) | TODO(owner) |
| R10 | Insider administrator misuse | 2 | 4 | T15 logging + alerts | Partially mitigated | TODO(owner) |
| R11 | Vulnerable dependency | 3 | 4 | Audits in CI, patch cadence | Mitigated (process) | Dev |
| R12 | AWS misconfiguration | 3 | 5 | Baseline + Trivy IaC scan | Open until baseline (AWS-SECURITY) | TODO(owner) |
| R13 | Polling load / DoS | 2 | 3 | Polls only while visible, shared between screens; per-user rate limits; WAF; autoscaling caps | Mitigated | Dev |
| R14 | Zscaler shared egress IPs trip IP-based limits | 3 | 3 | Limits keyed on user/email; WAF IP rule set high | Mitigated | Dev |
| R15 | Encryption key loss or leak (field encryption) | 2 | 5 | APP_KEY in Secrets Manager, rotation via `APP_PREVIOUS_KEYS`, backups of the secret | Partially mitigated — rotation runbook in phase 4 | TODO(owner) |

## 9. The final report (structure)

1. Scope and system description. 2. Method (tools in §6 with versions and dates). 3. Findings
table from each tool (severity, location, fix or justification). 4. Risk register (§8) with
mitigated, accepted (signed) and open risks. 5. Evidence annex (scan outputs, test run, config
screenshots). Templates live in `docs/security/`.
