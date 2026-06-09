#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Starting dev environment..."
uv sync --group dev
echo "Ready. Run 'deepagents-app chat' to start the REPL."
