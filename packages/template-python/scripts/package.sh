#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "from importlib.metadata import version; print(version('deepagents-dev-templates-python'))" 2>/dev/null || echo "0.0.0")
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
mkdir -p dist-packages
uv build --out-dir dist-packages
tar czf "dist-packages/deepagents-app-agent-${PLATFORM}-${ARCH}-${VERSION}.tar.gz" \
  -C dist-packages .
echo "Package: dist-packages/deepagents-app-agent-${PLATFORM}-${ARCH}-${VERSION}.tar.gz"
