# Deploying to AWS (outline — completes once the AWS baseline arrives)

The infrastructure must follow the organisation's AWS security baseline; the open questions are in
`docs/AWS-SECURITY.md`. This is the order of work; nothing here has been deployed yet.

1. **Accounts and network** (TODO(owner) Q1–Q2): VPC in eu-west-2 with private subnets for the
   app and database; internal Application Load Balancer (internet-facing only if external access
   is approved) with an ACM certificate, TLS 1.2+ policy, HTTP→HTTPS redirect, and AWS WAF
   (AWS managed core, known-bad-inputs, SQLi and IP-reputation rule groups; rate rule set high —
   Zscaler shares egress IPs).
2. **Data**: RDS PostgreSQL 16, Multi-AZ, encrypted with KMS, automated backups, `rds.force_ssl=1`;
   the app user owns only its schema. Private S3 bucket for attachments: Block Public Access,
   SSE-KMS, versioning, bucket policy allowing only the ECS task role, TLS-only.
3. **Secrets**: Secrets Manager entries for APP_KEY, DB password, SES SMTP credentials and the
   VAPID private key; injected into the ECS task definition as secrets.
4. **Image**: CI builds the root `Dockerfile`, Trivy scans it (fails on High/Critical), pushes to
   ECR with immutable tags and scan-on-push.
5. **Service**: ECS Fargate service (2+ tasks across AZs) from that image, environment from
   `api/.env.production.example`; a one-off task runs `php artisan migrate --force`; a scheduled
   task runs `php artisan schedule:run` every minute (or `schedule:work` as a second container).
6. **First administrator**: one-off task `php artisan voyager:make-admin <email> --host` — that
   person receives a set-password email and manages everyone else in the app.
7. **Monitoring**: container logs to CloudWatch (JSON security log on stderr); metric filters and
   alarms on `login_locked`, `access_denials_threshold`, `trip_read_threshold`, `role_change`,
   `request_refused` spikes and 5xx rates; GuardDuty and CloudTrail on; forward to the SIEM (Q6).
8. **Zscaler** (Q8): ZPA application segment for the internal ALB, or ZIA URL category + SSL
   inspection policy for the domain; allow the browser push services listed in
   `config/services.php` and (optionally) api.pwnedpasswords.com.
9. **Before go-live**: ZAP full scan on staging, manual checks M1–M10 (`docs/security/TESTING.md`),
   risk register signed by the risk owner.
