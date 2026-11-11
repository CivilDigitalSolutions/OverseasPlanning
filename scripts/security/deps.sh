#!/usr/bin/env bash
# Known-vulnerable dependencies (SECURITY-PLAN §6.1). Fails on any High/Critical in what ships.
source "$(dirname "$0")/_common.sh"
note "composer audit (api)"
(cd "$ROOT/api" && composer audit --no-dev --format=json > "$OUT/composer-audit.json") || { echo "composer audit found advisories"; exit 1; }
note "npm audit (web, shipped dependencies)"
(cd "$ROOT/web" && npm audit --omit=dev --json > "$OUT/npm-audit.json") || true
# Firebase packages are not in the AWS bundle (web/dist-aws); their advisories are recorded in the
# risk register rather than failing this check until Firebase is removed (MIGRATION-PLAN phase 6).
node -e '
const a = require(process.argv[1]);
const bad = Object.values(a.vulnerabilities || {}).filter(v => ["high","critical"].includes(v.severity)
  && !/^(@firebase\/|firebase$|@grpc\/)/.test(v.name));
if (bad.length) { console.error("High/critical:", bad.map(v => v.name).join(", ")); process.exit(1); }
console.log("npm: no high/critical outside the Firebase packages");' "$OUT/npm-audit.json"
