#!/usr/bin/env bash
# Publish packaged agent artifacts, metadata, scripts, and manifests to a
# MinIO/S3 bucket declared in .nuwax-agent/distribution.json.
#
# Behavior:
#   - Reads the version from --version, --from-tag, or the current git HEAD tag.
#   - Cross-checks package.json + agent-package.json versions; refuses on mismatch.
#   - Maps the version to a channel (stable vs beta) by inspecting the tag suffix.
#   - Uploads artifacts, metadata, scripts, and manifests under
#       engines/<engineId>/versions/<version>/
#   - Rewrites the matching channels/<channel>.json pointer and latest.json.
#   - Overwrites agent-engines/deepagents-app-ts/install-from-s3.sh so the
#     bootstrap URL always points to the current stable install script.
#
# Environment overrides:
#   NUWAX_S3_ENDPOINT, NUWAX_S3_REGION, NUWAX_S3_BUCKET
#   NUWAX_S3_ACCESS_KEY_ID, NUWAX_S3_SECRET_ACCESS_KEY  (or a pre-configured profile)
#
# Requires: aws cli, jq, git.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
DIST_CONFIG="$PKG_DIR/.nuwax-agent/distribution.json"
PKG_JSON="$PKG_DIR/package.json"
AGENT_PKG_JSON="$PKG_DIR/agent-package.json"
OUT_DIR="$PKG_DIR/dist-packages"

VERSION=""
TAG=""
CHANNEL=""
DRY_RUN=0
SKIP_POINTERS=0
PRUNE=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/publish-s3.sh --version 0.2.1 [--channel stable|beta]
  bash scripts/publish-s3.sh --from-tag v0.2.1
  bash scripts/publish-s3.sh --from-tag v0.3.0-rc.1 [--channel beta]

Options:
  --version VERSION      Version to publish (default: detect from package.json)
  --from-tag TAG         Read version from a git tag (e.g. v0.2.1, v0.3.0-rc.1)
  --channel NAME         Override channel detection (stable|beta)
  --dry-run              Print planned uploads without sending anything
  --skip-pointers        Upload artifacts but do not rewrite channels/latest
  --prune                Delete any prior S3 object under the same version prefix
                         (only for objects this script would also upload)
  -h, --help             Show help
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --from-tag) TAG="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-pointers) SKIP_POINTERS=1; shift ;;
    --prune) PRUNE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

require_cmd jq
require_cmd git
require_cmd node
# aws is only required for actual uploads; skip in dry-run.
if [[ "$DRY_RUN" -eq 0 ]]; then
  require_cmd aws
fi

# CI runs publish-s3.sh from GitHub Actions where secrets are already in
# process.env. We do NOT load .env here; credentials must come from the
# calling environment (workflow env / manual export). Map project-prefixed
# env vars to AWS_* so secrets can be named either way.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
fi
if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
fi

if [[ ! -f "$DIST_CONFIG" ]]; then
  echo "Distribution config not found: $DIST_CONFIG" >&2
  exit 1
fi

# ─── Resolve version ─────────────────────────────────────────
if [[ -n "$TAG" ]]; then
  if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
    echo "Git tag not found: $TAG" >&2
    exit 1
  fi
  # Strip leading 'v' if present.
  VERSION="${TAG#v}"
fi

if [[ -z "$VERSION" ]]; then
  VERSION=$(node -p "require('$PKG_JSON').version")
fi

PKG_VERSION=$(node -p "require('$PKG_JSON').version")
AGENT_VERSION=$(node -p "require('$AGENT_PKG_JSON').version")
AGENT_NAME=$(node -p "require('$AGENT_PKG_JSON').name")
PKG_NAME=$(node -p "require('$PKG_JSON').name")
if [[ "$VERSION" != "$PKG_VERSION" || "$VERSION" != "$AGENT_VERSION" ]]; then
  echo "Version mismatch: --version=$VERSION package.json=$PKG_VERSION agent-package.json=$AGENT_VERSION" >&2
  echo "Bump them to the same value or pass --version explicitly." >&2
  exit 1
fi

# ─── Resolve channel ────────────────────────────────────────
if [[ -z "$CHANNEL" ]]; then
  if [[ "$VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    CHANNEL="stable"
  elif [[ "$VERSION" =~ - ]]; then
    CHANNEL="beta"
  else
    CHANNEL="stable"
  fi
fi

if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "beta" ]]; then
  echo "Unsupported channel: $CHANNEL (expected: stable|beta)" >&2
  exit 1
fi

# ─── Resolve distribution config values ─────────────────────
ENDPOINT=${NUWAX_S3_ENDPOINT:-$(node -p "require('$DIST_CONFIG').endpoint.url")}
REGION=${NUWAX_S3_REGION:-$(node -p "require('$DIST_CONFIG').endpoint.region")}
BUCKET=${NUWAX_S3_BUCKET:-$(node -p "require('$DIST_CONFIG').bucket")}
# 与 install-from-s3.sh / s3-fetch.sh 一致：自签 MinIO 端点需 --no-verify-ssl
AWS_S3_COMMON_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
if [[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]]; then
  AWS_S3_COMMON_ARGS+=(--no-verify-ssl)
fi
ENGINE_ID=$(node -p "require('$DIST_CONFIG').engineId")
PREFIX=$(node -p "require('$DIST_CONFIG').prefix")
ARTIFACT_DIR=$(node -e "process.stdout.write(require('$DIST_CONFIG').artifacts.directory.replace('{version}',process.argv[1]))" "$VERSION")
METADATA_DIR=$(node -e "process.stdout.write(require('$DIST_CONFIG').metadata.directory.replace('{version}',process.argv[1]))" "$VERSION")
SCRIPTS_DIR=$(node -e "process.stdout.write(require('$DIST_CONFIG').scripts.directory.replace('{version}',process.argv[1]))" "$VERSION")
MANIFESTS_DIR=$(node -e "process.stdout.write(require('$DIST_CONFIG').manifests.directory.replace('{version}',process.argv[1]))" "$VERSION")
# Pointer keys are relative to PREFIX (S3_BASE already includes PREFIX).
LATEST_KEY="$(node -p "require('$DIST_CONFIG').pointers.latest")"
CHANNEL_KEY="channels/$CHANNEL.json"
VERSION_JSON_REL=$(node -e "const c=require('$DIST_CONFIG');process.stdout.write(c.consume.versionEndpointTemplate.replace('{version}',process.argv[1]).replace(c.prefix+'/',''))" "$VERSION")

# Validate that the required local artifacts exist.
for required in \
  "$OUT_DIR/${PKG_NAME}-$VERSION.tgz" \
  "$OUT_DIR/${AGENT_NAME}-$VERSION-nuwax.tar.gz" \
  "$OUT_DIR/${AGENT_NAME}-$VERSION-nuwax.zip" \
  "$OUT_DIR/${AGENT_NAME}-$VERSION.version.json" \
  "$OUT_DIR/${AGENT_NAME}-$VERSION.platform.json" \
  "$OUT_DIR/package-checksums.json" \
  "$OUT_DIR/agent-package.release.json"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing artifact: $required" >&2
    echo "Run 'bash scripts/package.sh --format all' first." >&2
    exit 1
  fi
done

VERSION_JSON_BODY=$(cat "$OUT_DIR/${AGENT_NAME}-$VERSION.version.json")
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse "${TAG:-HEAD}" 2>/dev/null || git rev-parse HEAD)

echo "Publishing $ENGINE_ID $VERSION (channel=$CHANNEL)"
echo "  endpoint: $ENDPOINT"
echo "  bucket:   $BUCKET"
echo "  prefix:   $PREFIX"
echo "  git sha:  $GIT_SHA"
echo

# ─── Build the S3 source list ──────────────────────────────
ARTIFACT_FILES=(
  "${PKG_NAME}-$VERSION.tgz"
  "${AGENT_NAME}-$VERSION-nuwax.tar.gz"
  "${AGENT_NAME}-$VERSION-nuwax.zip"
)
METADATA_FILES=(
  "${AGENT_NAME}-$VERSION.version.json"
  "${AGENT_NAME}-$VERSION.platform.json"
  "package-checksums.json"
  "agent-package.release.json"
)
SCRIPT_FILES=(
  "scripts/install.sh"
  "scripts/upgrade.sh"
  "scripts/uninstall.sh"
  "scripts/package.sh"
  "scripts/validate-package.sh"
  "scripts/publish-s3.sh"
  "scripts/release.sh"
  "scripts/s3-fetch.sh"
  "scripts/install-from-s3.sh"
)
MANIFEST_FILES=(
  "agent-package.json"
  "package.json"
  "template.manifest.json"
)

run_aws() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ aws $*"
  else
    aws "$@"
  fi
}

S3_BASE="s3://$BUCKET/$PREFIX"
S3_VERSIONED_BASE="$S3_BASE/versions/$VERSION"

# Optional prune of prior version (only inside our managed prefix).
if [[ "$PRUNE" -eq 1 ]]; then
  echo "Pruning prior objects under $S3_VERSIONED_BASE (managed subset) ..."
  run_aws s3 rm --recursive --quiet "$S3_VERSIONED_BASE" >/dev/null || true
fi

# ─── Upload artifacts ──────────────────────────────────────
echo "→ artifacts/"
for f in "${ARTIFACT_FILES[@]}"; do
  src="$OUT_DIR/$f"
  dst="$S3_BASE/$ARTIFACT_DIR/$f"
  echo "  put $f"
  run_aws s3 cp "$src" "$dst" "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "application/octet-stream" >/dev/null
done

# ─── Upload per-platform archives + platforms.json (nuwax-file-server) ───
# {agentName}-{os}-{arch}-{version}.{ext} plus the install-from-url platforms
# map. These are additive to the legacy *-nuwax.* artifacts above.
echo "→ artifacts/ (per-platform)"
PLATFORMS_JSON="$OUT_DIR/${AGENT_NAME}-${VERSION}.platforms.json"
ARTIFACT_PUBLIC_BASE="$ENDPOINT/$BUCKET/$PREFIX/$ARTIFACT_DIR"
if [[ -f "$PLATFORMS_JSON" ]]; then
  # Backfill PlatformEntry.url with the public S3 URL before upload so the
  # file-server can POST it straight to /agent-mgmt/agents/install-from-url.
  PUBLIC_BASE="$ARTIFACT_PUBLIC_BASE" node -e '
    const fs = require("fs");
    const file = process.argv[1];
    const base = process.env.PUBLIC_BASE.replace(/\/+$/, "");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const k of Object.keys(doc.platforms || {})) {
      doc.platforms[k].url = `${base}/${doc.platforms[k].file}`;
    }
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  ' "$PLATFORMS_JSON"
fi
shopt -s nullglob
for f in "$OUT_DIR/${AGENT_NAME}-"*"-${VERSION}".tar.gz "$OUT_DIR/${AGENT_NAME}-"*"-${VERSION}".zip; do
  base=$(basename "$f")
  echo "  put $base"
  run_aws s3 cp "$f" "$S3_BASE/$ARTIFACT_DIR/$base" "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "application/octet-stream" >/dev/null
done
shopt -u nullglob
if [[ -f "$PLATFORMS_JSON" ]]; then
  echo "  put $(basename "$PLATFORMS_JSON")"
  run_aws s3 cp "$PLATFORMS_JSON" "$S3_BASE/$ARTIFACT_DIR/$(basename "$PLATFORMS_JSON")" \
    "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "application/json" >/dev/null
fi

# ─── Upload metadata ───────────────────────────────────────
echo "→ metadata/"
for f in "${METADATA_FILES[@]}"; do
  src="$OUT_DIR/$f"
  ext="application/octet-stream"
  case "$f" in
    *.json) ext="application/json" ;;
  esac
  dst="$S3_BASE/$METADATA_DIR/$f"
  echo "  put $f"
  run_aws s3 cp "$src" "$dst" "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "$ext" >/dev/null
done

# ─── Upload scripts ────────────────────────────────────────
echo "→ scripts/"
for f in "${SCRIPT_FILES[@]}"; do
  src="$PKG_DIR/$f"
  if [[ ! -f "$src" ]]; then
    echo "  skip $f (not found locally; upload it once it lands in scripts/)"
    continue
  fi
  base=$(basename "$f")
  dst="$S3_BASE/$SCRIPTS_DIR/$base"
  echo "  put $base"
  run_aws s3 cp "$src" "$dst" "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "text/x-shellscript" >/dev/null
done

# ─── Upload manifests ──────────────────────────────────────
echo "→ manifests/"
for f in "${MANIFEST_FILES[@]}"; do
  src="$PKG_DIR/$f"
  if [[ ! -f "$src" ]]; then
    echo "  skip $f (not found locally)"
    continue
  fi
  dst="$S3_BASE/$MANIFESTS_DIR/$f"
  echo "  put $f"
  run_aws s3 cp "$src" "$dst" "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "application/json" >/dev/null
done

# .nuwax-agent/ directory (configuration)
echo "→ manifests/.nuwax-agent/"
if [[ -d "$PKG_DIR/.nuwax-agent" ]]; then
  while IFS= read -r -d '' f; do
    rel="${f#$PKG_DIR/}"
    dst="$S3_BASE/$MANIFESTS_DIR/$rel"
    ext="application/octet-stream"
    case "$rel" in
      *.json) ext="application/json" ;;
    esac
    echo "  put $rel"
    run_aws s3 cp "$f" "$dst" "${AWS_S3_COMMON_ARGS[@]}" \
      --cache-control "public, max-age=31536000, immutable" \
      --content-type "$ext" >/dev/null
  done < <(find "$PKG_DIR/.nuwax-agent" -type f -print0)
fi

# The distribution.json itself (so consumers can introspect the layout).
echo "→ manifests/.nuwax-agent/distribution.json (the config that drove this upload)"
run_aws s3 cp "$DIST_CONFIG" "$S3_BASE/$MANIFESTS_DIR/.nuwax-agent/distribution.json" \
  "${AWS_S3_COMMON_ARGS[@]}" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/json" >/dev/null

# ─── Rewrite channel pointer + latest ─────────────────────
if [[ "$SKIP_POINTERS" -eq 0 ]]; then
  echo
  echo "→ channels/$CHANNEL.json"
  channel_body=$(CHANNEL="$CHANNEL" VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" PREFIX="$PREFIX" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.agent.channel.v1",
  channel: process.env.CHANNEL,
  engineId: "deepagents-app-ts",
  packageName: "deepagents-app-ts",
  version: process.env.VERSION,
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
  artifactBase: `${process.env.PREFIX}/versions/${process.env.VERSION}/artifacts/`,
  versionJsonPath: `${process.env.PREFIX}/versions/${process.env.VERSION}/metadata/.version.json`,
}, null, 2) + "\n");
NODE
)
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ aws s3 cp - $S3_BASE/$CHANNEL_KEY <<< $channel_body"
  else
    printf '%s' "$channel_body" | aws s3 cp - "$S3_BASE/$CHANNEL_KEY" \
      "${AWS_S3_COMMON_ARGS[@]}" \
      --cache-control "public, max-age=60, must-revalidate" \
      --content-type "application/json"
  fi

  # Only let stable update latest.json; beta does not bump latest.
  if [[ "$CHANNEL" == "stable" ]]; then
    echo "→ latest.json"
    latest_body=$(CHANNEL="$CHANNEL" VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.agent.latest.v1",
  channel: process.env.CHANNEL,
  engineId: "deepagents-app-ts",
  packageName: "deepagents-app-ts",
  version: process.env.VERSION,
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
}, null, 2) + "\n");
NODE
)
    if [[ "$DRY_RUN" -eq 1 ]]; then
      echo "+ aws s3 cp - $S3_BASE/$LATEST_KEY <<< $latest_body"
    else
      printf '%s' "$latest_body" | aws s3 cp - "$S3_BASE/$LATEST_KEY" \
        "${AWS_S3_COMMON_ARGS[@]}" \
        --cache-control "public, max-age=60, must-revalidate" \
        --content-type "application/json"
    fi
  else
    echo "→ latest.json (skipped, channel=beta does not bump latest)"
  fi
fi

# ─── Overwrite bootstrap (install-from-s3.sh) ─────────────
# Always overwrite the canonical bootstrap URL with the current stable
# install-from-s3.sh so the one-liner on a fresh cloud computer always works.
# We do this regardless of channel so the bootstrap script itself is the
# single source of truth at the well-known key.
echo
echo "→ bootstrap (install-from-s3.sh)"
BOOTSTRAP_KEY="$PREFIX/install-from-s3.sh"
if [[ -f "$PKG_DIR/scripts/install-from-s3.sh" ]]; then
  run_aws s3 cp "$PKG_DIR/scripts/install-from-s3.sh" "s3://$BUCKET/$BOOTSTRAP_KEY" \
    "${AWS_S3_COMMON_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
  echo "  put install-from-s3.sh → s3://$BUCKET/$BOOTSTRAP_KEY"
else
  echo "  skip install-from-s3.sh (not present locally; bootstrap will not work until added)"
fi

echo
echo "Publish complete: $ENGINE_ID $VERSION on $CHANNEL"
echo "Discovery endpoints:"
echo "  latest:        $ENDPOINT/$BUCKET/$PREFIX/$LATEST_KEY"
echo "  $CHANNEL:      $ENDPOINT/$BUCKET/$PREFIX/$CHANNEL_KEY"
echo "  version:       $ENDPOINT/$BUCKET/$PREFIX/$VERSION_JSON_REL"
echo "  bootstrap:     $ENDPOINT/$BUCKET/$BOOTSTRAP_KEY"
