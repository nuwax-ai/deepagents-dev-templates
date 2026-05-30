#!/usr/bin/env bash
# Development helper script
set -euo pipefail

echo "🚀 Starting DeepAgents development server..."
echo ""

# Check .env exists
if [ ! -f ".env" ]; then
  echo "⚠️  No .env file found. Copying from .env.example..."
  cp .env.example .env
  echo "  📝 Edit .env with your API keys before continuing"
  echo ""
fi

# Check required dependencies
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Start in dev mode
echo "🔧 Starting in development mode..."
echo "   Press Ctrl+C to stop"
echo ""
npx tsx src/index.ts --debug
