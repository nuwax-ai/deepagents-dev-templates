#!/usr/bin/env bash
# Thin wrapper — logic lives in lib/bundle.mjs (cross-platform).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/lib/bundle.mjs" "$@"
