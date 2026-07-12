#!/usr/bin/env bash
# run-static.sh — Dev-Agent Flow iteration static gate (prompts / skills / mcp-usage / drift)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PKG="$(cd "$ROOT/.." && pwd)"
CHECKS="$ROOT/checks"
PYTHON="${PYTHON:-python3}"

echo "==> iteration static checks (pkg=$PKG)"

run() {
  local name="$1"
  echo "--- $name"
  "$PYTHON" "$CHECKS/$name.py"
}

run check-manifest
run check-prompts
run check-skills
run check-mcp-usage
run check-case-schema
run check-platform-drift

echo "==> all static checks passed"
