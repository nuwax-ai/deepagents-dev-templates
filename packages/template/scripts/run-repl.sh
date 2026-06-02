#!/usr/bin/env bash
# Quick start: launch the code assistant REPL
# Usage: bash scripts/run-repl.sh
#
# Reads ANTHROPIC_API_KEY from .env if it exists.

set -euo pipefail

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "⚠️  No ANTHROPIC_API_KEY or OPENAI_API_KEY set."
  echo "   Copy .env.example to .env and fill in your key."
  echo ""
fi

# Launch REPL with code assistant prompt
exec npx tsx src/index.ts chat \
  --prompt-file prompts/code-assistant.system.md \
  "$@"
