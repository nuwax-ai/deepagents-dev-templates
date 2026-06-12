#!/usr/bin/env bash
# Smoke-test the bundled ACP agent via rcoder-cli (inline one-shot chat).
#
# Provider-agnostic: works for BOTH the Anthropic-default config and the
# OpenAI-compatible protocol. The agent's inferModelProviderIfUnset() picks the
# provider from whichever credential family is present (see
# src/runtime/config/config-sources.ts and docs/guides/rcoder-cloud-debug.md),
# so we forward every relevant credential/model/provider env var to the rcoder
# subprocess rather than assuming Anthropic.
#
# Why -e at all: rcoder-cli launches the agent with a sanitized environment, so
# credentials exported in your shell (the Zed / rcoder OpenAI-profile case) never
# reach the agent unless forwarded explicitly. We also source ./.env first, so
# this works when credentials live only in .env.
#
# Why skip empties: model.baseUrl is z.string().url().optional(); an empty string
# ("") fails .url() with "Invalid url". Forwarding an unset var as
# `-e VAR=$VAR` would inject "" and re-trigger that crash, so every value is
# forwarded only when non-empty.
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
in ./.env or your shell environment, then re-run. See docs/guides/rcoder-cloud-debug.md.
EOF
  exit 1
fi

# Credential / model / provider env vars to forward to the rcoder subprocess.
# Empty values are skipped to avoid injecting "" into URL fields (Zod "Invalid url").
forward_vars=(
  ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_MODEL
  OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL
  DEFAULT_MODEL LLM_PROVIDER
)
env_args=()
for v in "${forward_vars[@]}"; do
  val="${!v:-}"
  [[ -z "$val" ]] && continue
  env_args+=( -e "$v=$val" )
done

prompt="${SMOKE_PROMPT:-hello}"
timeout_s="${SMOKE_TIMEOUT:-30}"

# Ensure the self-contained bundle exists (e.g. after `pnpm run clean`).
if [[ ! -f dist/bundle.mjs ]]; then
  echo "dist/bundle.mjs not found — building via pnpm run bundle…" >&2
  pnpm run bundle >/dev/null
fi

# rcoder-cli v0.1.1: -c takes only the executable name; command args go via --arg.
exec pnpm dlx rcoder-cli chat \
  -c node --arg dist/bundle.mjs \
  -w "$PKG_DIR" \
  -p "$prompt" \
  --timeout "$timeout_s" \
  --mode yolo \
  -q \
  "${env_args[@]}"
