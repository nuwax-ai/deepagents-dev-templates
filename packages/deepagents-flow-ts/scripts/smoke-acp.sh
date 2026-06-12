#!/usr/bin/env bash
# Smoke-test a flow ACP agent via rcoder-cli (inline one-shot chat).
#
# Mirrors deepagents-app-ts/scripts/smoke-acp.sh, adapted for this package.
# Defaults to the package's DEFAULT flow (src/index.ts). Set AGENT_ENTRY to
# target another entry — e.g. AGENT_ENTRY=examples/rag/index.ts to smoke the
# RAG example (the `smoke:rag` npm script does exactly that).
#
# Provider-agnostic: the runtime picks the provider from whichever credential
# family is present, so we forward every relevant credential/model/provider env
# var to the rcoder subprocess rather than assuming Anthropic.
#
# Why -e at all: rcoder-cli launches the agent with a SANITIZED environment, so
# credentials exported in your shell (the Zed / rcoder OpenAI-profile case) never
# reach the agent unless forwarded explicitly. We also source ./.env first, so
# this works when credentials live only in .env.
#
# Why skip empties: an empty OPENAI_BASE_URL ("") fails Zod .url() with
# "Invalid url". Forwarding an unset var as `-e VAR=$VAR` would inject "" and
# re-trigger that crash, so every value is forwarded only when non-empty.
#
# Why NO --tsconfig / --config flags on the agent command: rcoder-cli v0.1.1
# takes `-c <executable>` + repeated `--arg <value>`, and its arg parser REJECTS
# values that start with '--' (e.g. `--arg --tsconfig` → "unexpected argument").
# We avoid that by passing no flags and relying on defaults:
#   * tsx auto-loads tsconfig.json from the -w working dir.
#   * the server's default config resolves to config/rag-agent.config.json
#     (PACKAGE_ROOT is derived from import.meta.url — see src/runtime/config.ts).
#
# NOTE: `set -u` is intentionally omitted — bash 3.2 (macOS default) errors on
# expanding an empty "${env_args[@]}" under `set -u`. All refs use `${!v:-}`.
set -eo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PKG_DIR"

# Source .env if present so credentials stored there are picked up even when the
# surrounding shell doesn't export them.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env || true
  set +a
fi

# Fail fast with a clear message when no credential is configured, instead of
# spawning rcoder into a Zod / "no API key" crash.
has_cred=0
for v in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN OPENAI_API_KEY; do
  if [[ -n "${!v:-}" ]]; then has_cred=1; break; fi
done
if [[ $has_cred -eq 0 ]]; then
  cat >&2 <<'EOF'
ERROR: no model credential found for smoke:acp.
Set at least one of:
  - Anthropic:         ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) [+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL]
  - OpenAI-compatible: OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL
in ./.env or your shell environment, then re-run.
EOF
  exit 1
fi

# Resolve tsx: prefer the package-local bin (self-contained), fall back to PATH.
# An absolute path is used because rcoder's sanitized env may not include the
# workspace's node_modules/.bin on PATH.
TSX_BIN="$PKG_DIR/node_modules/.bin/tsx"
if [[ ! -x "$TSX_BIN" ]]; then TSX_BIN="tsx"; fi

# Credential / model / provider / logging env vars to forward to the rcoder
# subprocess. Empty values are skipped (see header).
forward_vars=(
  ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_MODEL
  OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL
  DEFAULT_MODEL LLM_PROVIDER
  LOG_DIR LOG_LEVEL
)
env_args=()
for v in "${forward_vars[@]}"; do
  val="${!v:-}"
  [[ -z "$val" ]] && continue
  env_args+=( -e "$v=$val" )
done

prompt="${SMOKE_PROMPT:-如何用 React 的 useState 管理组件状态？请给出基本用法}"
# RAG turn does rewrite + retrieve + generate (incl. spawning MCP servers), so
# it needs far more than rcoder's 30s chat default.
timeout_s="${SMOKE_TIMEOUT:-150}"
verbose=()
[[ "${SMOKE_VERBOSE:-0}" == "1" ]] && verbose=( -v )

# Agent entry: default = package default flow (src/index.ts). Override via env
# to smoke another flow (e.g. AGENT_ENTRY=examples/rag/index.ts for RAG).
# Deliberately no --tsconfig/--config flag — rcoder-cli v0.1.1 rejects values
# that start with '--' (see header); tsx auto-loads tsconfig.json from -w.
AGENT_ENTRY="${AGENT_ENTRY:-src/index.ts}"

exec pnpm dlx rcoder-cli chat \
  -c "$TSX_BIN" --arg "$AGENT_ENTRY" \
  -w "$PKG_DIR" \
  -p "$prompt" \
  --timeout "$timeout_s" \
  --mode yolo \
  -q \
  "${verbose[@]}" \
  "${env_args[@]}"
