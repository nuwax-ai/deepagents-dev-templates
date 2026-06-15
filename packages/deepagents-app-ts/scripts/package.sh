#!/usr/bin/env bash
# Thin wrapper — logic lives in package.mjs (cross-platform).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/package.mjs" "$@"
