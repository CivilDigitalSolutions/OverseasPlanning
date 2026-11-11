#!/usr/bin/env bash
# Everything that runs without a deployed instance (CI runs this on every change).
source "$(dirname "$0")/_common.sh"
note "API tests (incl. cross-trip denial)"; (cd "$ROOT/api" && php artisan test)
note "Web tests + build";                   (cd "$ROOT/web" && npm test && npm run build:aws)
"$ROOT/scripts/security/deps.sh"
"$ROOT/scripts/security/sast.sh"
command -v gitleaks >/dev/null && "$ROOT/scripts/security/secrets.sh" || echo "gitleaks not installed — skipped"
echo "Evidence in $OUT"
