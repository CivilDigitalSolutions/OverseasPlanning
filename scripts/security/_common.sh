# Shared by the security scripts: results go to reports/security/<date>/ for the evidence annex.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${SECURITY_OUT:-$ROOT/reports/security/$(date +%Y-%m-%d)}"
mkdir -p "$OUT"
note() { printf '\n== %s ==\n' "$*"; }
