# Security testing — how to run it

Plan and rationale: `docs/SECURITY-PLAN.md` §6. Every script writes its output to
`reports/security/<date>/` (git-ignored); attach those files to the report as evidence.

| What | Command | Where it runs |
|---|---|---|
| API tests (access control incl. cross-trip denial, approvals, encryption, append-only, RASP) | `cd api && php artisan test` | CI + locally (needs PostgreSQL) |
| Web tests + AWS bundle | `cd web && npm test && npm run build:aws` | CI + locally |
| Dependencies | `scripts/security/deps.sh` | CI + locally |
| SAST (Semgrep + Larastan level 6) | `scripts/security/sast.sh` | CI (Semgrep registry packs need internet) |
| Secrets in git history | `scripts/security/secrets.sh` | CI (gitleaks) |
| Container image + Dockerfile | `scripts/security/trivy.sh` | CI (`image` job) |
| DAST | `scripts/security/zap.sh https://<staging> baseline` then `full` | Against STAGING only, with written permission |
| Everything offline | `scripts/security/all.sh` | Locally |

## MobSF

Not applicable while Voyager is a PWA — MobSF needs an APK/AAB/IPA (SECURITY-PLAN §6.2). If the
app is ever wrapped (Capacitor / Trusted Web Activity), add MobSF static + dynamic scans of the
wrapper here and to CI.

## ZAP, signed in

The baseline scan only sees the sign-in screen. For the full scan, create a dedicated test account
on staging (never a real person's), sign in once in a browser, and give ZAP the session:
1. In ZAP: Context → include `https://<staging>/api/v1/.*`; Session management → cookie-based.
2. Authentication → JSON-based: `POST /api/v1/auth/login` with
   `{"email":"{%username%}","password":"{%password%}","agree":true}`; logged-in indicator
   `"user":{"uid"`; send `Referer: https://<staging>/` (the API refuses sign-in from other origins).
3. Exclude `POST /api/v1/auth/logout` so the scan does not sign itself out.
Expect the anomaly detector to raise `access_denials_threshold` events during an active scan —
run staging in `SECURITY_RASP_MODE=detect`, and record the events as evidence that detection works.

## Manual checks for a PWA (SECURITY-PLAN §6.3)

| # | Check | How | Expected |
|---|---|---|---|
| M1 | No trip data in browser storage | DevTools → Application → Local/Session storage, IndexedDB, Cache Storage after using every tab | Only the app shell in Cache Storage; no `/api/` responses anywhere |
| M2 | Session cookie flags | DevTools → Cookies | Session cookie `HttpOnly`, `Secure`, `SameSite=Lax`; `__Host-` prefix in production |
| M3 | HTTPS only | `curl -I http://<host>` | Redirect to HTTPS at the load balancer; HSTS on HTTPS responses |
| M4 | Idle timeout | Sign in, leave the app open untouched 31 min | Signed out; polls did not keep it alive |
| M5 | Sign-out | Sign out, press Back | Sign-in screen; API calls answer 401 |
| M6 | Lost phone | Administrator deletes or disables the account | Phone's next request answers 401/403 and shows sign-in |
| M7 | Notification content | Trigger a message notification | Push says only "New message" — no names or text |
| M8 | Cross-trip | As a member of trip A, request `/api/v1/trips/<B>` | 404 |
| M9 | Upload types | Upload an `.html` file, then download it | Downloaded as an attachment, never rendered in the browser |
| M10 | Headers | `curl -I https://<host>/` and `/api/v1/auth/session` | CSP, HSTS, nosniff, frame-ancestors none, no `X-Powered-By` |
