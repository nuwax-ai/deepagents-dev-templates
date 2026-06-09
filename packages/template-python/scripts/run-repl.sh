#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Starting REPL..."
uv run deepagents-app chat
