#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Building deepagents-dev-templates-python..."
uv build
echo "Build complete. See dist/ for output."
