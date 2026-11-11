# AWS move and security assurance — decisions and open items

Status: **API and PWA client built (2026-11-11), not deployed.** Plan: `docs/MIGRATION-PLAN.md`;
security: `docs/SECURITY-PLAN.md`; deployment order: `docs/DEPLOY-AWS.md`. The live app still runs on Firebase.
Items marked **TODO(owner)** are waiting on the owner — do not invent answers.

## Decisions (owner, 2026-11-11)

- **Hosting:** AWS. Backend to be rebuilt on **Laravel + Sanctum** (SPA cookie auth, same domain as
  the PWA). The React front end stays; `web/src/store.ts` is replaced by an API client.
- **Admin UI:** Filament is **not required**. The existing in-app account manager stays in React;
  Filament would add a second UI (Livewire) and more attack surface. Revisit only if a separate
  back-office is wanted.
- **Assurance framework:** UK government **Secure by Design**. Code-level controls follow
  OWASP ASVS. Artefacts needed: named senior risk owner, threat model, risk register (mitigated /
  accepted with reason), continuous assurance evidence.
- **Form:** stays a **PWA** for now (no native wrapper).
- **Exposure:** internal only is the aim (likely behind Zscaler Private Access); external access
  must remain possible.

## Consequences of staying a PWA

- **MobSF has nothing to scan.** It tests APK/AAB/IPA packages. Testing for the security report
  is therefore web-based: OWASP ZAP (DAST), Semgrep + Larastan (SAST), `composer audit` /
  `npm audit` (dependencies). MobSF comes into play only if the app is later wrapped
  (Capacitor / Trusted Web Activity).
- **No on-device RASP.** Root/tamper/hooking detection needs a native wrapper. Runtime protection
  is server-side: AWS WAF managed rules, Laravel rate limiting and lock-outs, anomaly alerts
  (e.g. one account reading many trips), GuardDuty, and a written incident-response procedure.

## Zscaler

- No certificate pinning (breaks under TLS inspection).
- Everything on the organisation's own domain; no third-party CDNs.
- Websockets may be blocked by inspection: allow-list the domain or fall back to polling.
- Web push relies on browser push services (Google, Apple, Mozilla) — confirm they are reachable.

## TODO(owner) — AWS security baseline (follow up)

Obtain the organisation's AWS security baseline document, then answer:

1. Account / landing zone: which AWS account and region (UK: eu-west-2)? Control Tower / SCPs?
2. Network: private subnets only? Load balancer + AWS WAF required? Any mandated TLS policy?
3. Compute: EC2, ECS/Fargate or other? CIS-hardened or organisation-approved images? IMDSv2?
4. Data: RDS engine required? KMS customer-managed keys for RDS and S3? Backup/retention rules?
5. Secrets: Secrets Manager or Parameter Store?
6. Logging and detection: CloudTrail, GuardDuty, Security Hub, CloudWatch — any central SIEM to
   forward to?
7. Identity: must sign-in federate to the organisation's IdP (Entra ID / SAML / OIDC) instead of
   email + password + passkeys?
8. Zscaler: ZIA or ZPA for this app? Domain category and SSL-inspection policy?
9. Devices: are phones managed (MDM, e.g. Intune)?
10. Who is the Secure by Design senior risk owner, and what is the risk appetite?
