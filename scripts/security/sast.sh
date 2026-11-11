#!/usr/bin/env bash
# Static analysis: Semgrep (PHP, Laravel, TypeScript/React, secrets) + Larastan.
source "$(dirname "$0")/_common.sh"
note "Semgrep"
semgrep scan --config "$ROOT/scripts/security/semgrep.yml" --config p/php --config p/typescript --config p/react --config p/secrets \
  --metrics=off --error --json --output "$OUT/semgrep.json" "$ROOT/api/app" "$ROOT/api/routes" "$ROOT/api/config" "$ROOT/web/src"
note "Larastan"
"$ROOT/scripts/security/larastan.sh"
