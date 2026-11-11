#!/usr/bin/env bash
# Secrets committed to git, across the whole history.
source "$(dirname "$0")/_common.sh"
gitleaks git "$ROOT" --redact --report-format json --report-path "$OUT/gitleaks.json"
