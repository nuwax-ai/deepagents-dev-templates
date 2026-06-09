#!/usr/bin/env bash
# Bootstrap a fresh cloud computer into an installed agent.
#
# Pulled by the cloud computer with a one-liner:
#   bash <(curl -fsSL $NUWAX_S3_ENDPOINT/$NUWAX_S3_BUCKET/agent-engines/deepagents-app-ts/install-from-s3.sh) \
#     --channel stable \
#     --install-root /opt/nuwax/deepagents-template
#
# This script:
#   1. Reads the channel pointer to find the current version.
#   2. Downloads the matching install.sh and s3-fetch.sh to a temp dir.
#   3. Execs install.sh --from-bucket with the same channel + install-root.
#
# Requires: aws cli, curl, bash, node, jq.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-from-s3.sh [options]

Options:
  --channel <stable|beta>   Channel to resolve (default: stable)
  --install-root DIR        Target install directory (default: /opt/nuwax/deepagents-template)
  --no-verify-ssl           Pass through to `aws s3 cp`
  --aws-endpoint <url>      Override NUWAX_S3_ENDPOINT for this invocation
  --aws-bucket <name>       Override NUWAX_S3_BUCKET for this invocation
  -h, --help                Show help

Environment:
  NUWAX_S3_ENDPOINT, NUWAX_S3_REGION, NUWAX_S3_BUCKET
  NUWAX_S3_ACCESS_KEY_ID, NUWAX_S3_SECRET_ACCESS_KEY
  Must be exported before running. The cloud computer (rcoder) is expected
  to inject these at launch time.
EOF
}

CHANNEL="stable"
INSTALL_ROOT="/opt/nuwax/deepagents-template"
NO_VERIFY_SSL=0
AWS_ENDPOINT_OVERRIDE=""
AWS_BUCKET_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="${2:-stable}"; shift 2 ;;
    --install-root) INSTALL_ROOT="${2:-}"; shift 2 ;;
    --no-verify-ssl) NO_VERIFY_SSL=1; shift ;;
    --aws-endpoint) AWS_ENDPOINT_OVERRIDE="${2:-}"; shift 2 ;;
    --aws-bucket) AWS_BUCKET_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -n "$AWS_ENDPOINT_OVERRIDE" ]]; then
  export NUWAX_S3_ENDPOINT="$AWS_ENDPOINT_OVERRIDE"
fi
if [[ -n "$AWS_BUCKET_OVERRIDE" ]]; then
  export NUWAX_S3_BUCKET="$AWS_BUCKET_OVERRIDE"
fi
if [[ "$NO_VERIFY_SSL" -eq 1 ]]; then
  export NUWAX_S3_NO_VERIFY_SSL=1
fi

# Defaults for the public nuwax packages bucket.
: "${NUWAX_S3_ENDPOINT:=https://s3.nuwax.com:9443}"
: "${NUWAX_S3_BUCKET:=nuwax-packages}"
: "${NUWAX_S3_PREFIX:=agent-engines/deepagents-app-ts}"
: "${NUWAX_S3_ENGINE_ID:=deepagents-app-ts}"
: "${NUWAX_S3_REGION:=us-east-1}"
export NUWAX_S3_ENDPOINT NUWAX_S3_BUCKET NUWAX_S3_PREFIX NUWAX_S3_ENGINE_ID NUWAX_S3_REGION

ENGINE_PREFIX="agent-engines/deepagents-app-ts"
ENDPOINT_ARGS=(--endpoint-url "$NUWAX_S3_ENDPOINT" --no-sign-request)
if [[ -n "${NUWAX_S3_REGION:-}" ]]; then
  ENDPOINT_ARGS+=(--region "$NUWAX_S3_REGION")
fi
if [[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]]; then
  ENDPOINT_ARGS+=(--no-verify-ssl)
fi

echo "Resolving channel '$CHANNEL' from s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/channels/$CHANNEL.json"
POINTER=$(aws s3 cp "s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/channels/$CHANNEL.json" - "${ENDPOINT_ARGS[@]}")
VERSION=$(printf '%s' "$POINTER" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{process.stdout.write(JSON.parse(s).version||'')}catch(e){process.stderr.write('Failed to parse channel pointer as JSON. Is NUWAX_S3_ENDPOINT/NUWAX_S3_BUCKET correct?\n'+e.message+'\n');process.exit(2)}})")
if [[ -z "$VERSION" ]]; then
  echo "Channel pointer for '$CHANNEL' has no .version field" >&2
  exit 1
fi
echo "Channel '$CHANNEL' → version $VERSION"

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-bootstrap-XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching scripts and metadata for version $VERSION ..."
aws s3 cp "s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/versions/$VERSION/scripts/s3-fetch.sh" "$TMP_DIR/s3-fetch.sh" "${ENDPOINT_ARGS[@]}"
aws s3 cp "s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/versions/$VERSION/scripts/install.sh"   "$TMP_DIR/install.sh"   "${ENDPOINT_ARGS[@]}"
aws s3 cp "s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/versions/$VERSION/scripts/upgrade.sh"   "$TMP_DIR/upgrade.sh"   "${ENDPOINT_ARGS[@]}"
# Also fetch agent-package.json and package.json so install.sh can read metadata
# even when running from a temp directory.
aws s3 cp "s3://$NUWAX_S3_BUCKET/$ENGINE_PREFIX/versions/$VERSION/manifests/agent-package.json" "$TMP_DIR/agent-package.json" "${ENDPOINT_ARGS[@]}"
chmod +x "$TMP_DIR/install.sh" "$TMP_DIR/s3-fetch.sh" "$TMP_DIR/upgrade.sh"

if [[ -d "$INSTALL_ROOT" && -f "$INSTALL_ROOT/dist/index.js" ]]; then
  echo "Existing install detected at $INSTALL_ROOT — switching to upgrade mode"
  exec bash "$TMP_DIR/upgrade.sh" --from-bucket --channel "$CHANNEL" --install-root "$INSTALL_ROOT"
else
  echo "No existing install — running fresh install"
  exec bash "$TMP_DIR/install.sh" --from-bucket --channel "$CHANNEL" --install-root "$INSTALL_ROOT"
fi
