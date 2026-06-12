#!/usr/bin/env bash
# Build script for DeepAgents Dev Templates
set -euo pipefail

echo "🔨 Building deepagents-flow-ts..."

# Clean
rm -rf dist/
echo "  ✅ Cleaned dist/"

# Type check
echo "  📋 Type checking..."
npx tsc --noEmit
echo "  ✅ Type check passed"

# Compile
echo "  📦 Compiling TypeScript..."
npx tsc
echo "  ✅ Compiled to dist/"

# Verify entry point
if [ -f "dist/index.js" ]; then
  echo "  ✅ Entry point verified: dist/index.js"
else
  echo "  ❌ Entry point missing: dist/index.js"
  exit 1
fi

echo ""
echo "✅ Build complete!"
echo "   Run: npm start"
echo "   Or:  node dist/index.js"
