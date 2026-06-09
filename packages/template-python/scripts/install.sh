#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Installing deepagents-dev-templates-python..."
uv sync
echo "Installation complete."
