#!/usr/bin/env bash
# DAST with OWASP ZAP against a RUNNING STAGING instance (never production).
#   scripts/security/zap.sh https://voyager-staging.example.org [baseline|full]
# Baseline = passive scan, safe and quick. Full = active attacks; staging only, with permission.
# Signed-in scanning: add a ZAP context with a test account (see docs/security/TESTING.md).
source "$(dirname "$0")/_common.sh"
TARGET="${1:?usage: zap.sh <url> [baseline|full]}"
MODE="${2:-baseline}"
docker run --rm -v "$OUT:/zap/wrk:rw" -t ghcr.io/zaproxy/zaproxy:stable \
  "zap-${MODE}.py" -t "$TARGET" -r "zap-${MODE}.html" -J "zap-${MODE}.json" -I || true
echo "Report: $OUT/zap-${MODE}.html"
