#!/usr/bin/env bash
# Install script for deepagents-app-agent
# Supports: npm, tgz, git
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_PKG="$PKG_DIR/agent-package.json"

NAME=$(node -p "require('$AGENT_PKG').name")
VERSION=$(node -p "require('$AGENT_PKG').version")

echo "📦 Installing ${NAME} v${VERSION}..."

# Detect install source
if [ -f "$PKG_DIR/deepagents-dev-templates-${VERSION}.tgz" ]; then
  SOURCE="tgz"
  SOURCE_PATH="$PKG_DIR/deepagents-dev-templates-${VERSION}.tgz"
elif [ -f "$PKG_DIR/agent-package.release.json" ]; then
  SOURCE=$(node -p "require('$PKG_DIR/agent-package.release.json').source.type || 'npm'")
else
  SOURCE="npm"
fi

echo "  Source: $SOURCE"

# Install dependencies
echo ""
echo "📋 Installing dependencies..."
cd "$PKG_DIR"
npm install --production

# Verify Node version
NODE_MAJOR=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "  ⚠️  Warning: Node.js >= 20 required, found $(node -v)"
fi

# Verify build
echo ""
echo "🔨 Verifying build..."
if [ ! -f "$PKG_DIR/dist/index.js" ]; then
  echo "  Building from source..."
  npm run build
fi

# Check required env vars
echo ""
echo "🔑 Checking credentials..."
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "  ⚠️  No LLM credentials found. Set one of:"
  echo "     ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Quick start:"
echo "  npm run start:acp     # Start ACP server"
echo "  npm run start:chat    # Start interactive chat"
echo "  npm run test          # Run tests"
echo ""
echo "Zed config location:"
echo "  ~/.config/zed/settings.json"
