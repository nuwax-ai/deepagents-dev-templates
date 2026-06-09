#!/usr/bin/env bash
# Tag-driven release orchestrator.
#
#   bash scripts/release.sh v0.2.1            # stable
#   bash scripts/release.sh v0.3.0-rc.1       # beta (pre-release tag)
#   bash scripts/release.sh v0.3.0-rc.1 --skip-publish
#
# Steps:
#   1. Read version from the supplied git tag.
#   2. Refuse to proceed if the working tree is dirty, unless --allow-dirty.
#   3. Refuse to proceed if package.json + agent-package.json do not match the tag.
#   4. Run scripts/package.sh --format all to regenerate artifacts.
#   5. Run scripts/publish-s3.sh --from-tag <tag> to push to MinIO/S3.
#
# Requires: bash, git, node, the aws cli, jq.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

TAG="${1:-}"
ALLOW_DIRTY=0
SKIP_PACKAGE=0
SKIP_PUBLISH=0
SKIP_TESTS=1
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/release.sh <git-tag> [options]

Options:
  --allow-dirty        Proceed even if the working tree has uncommitted changes
  --skip-package       Do not run scripts/package.sh (assume artifacts exist)
  --skip-publish       Do not run scripts/publish-s3.sh (only rebuild locally)
  --skip-tests         Skip vitest during package.sh (default)
  --no-skip-tests      Run vitest during package.sh
  --dry-run            Forward --dry-run to package.sh and publish-s3.sh
  -h, --help           Show help

Examples:
  bash scripts/release.sh v0.2.1
  bash scripts/release.sh v0.3.0-rc.1 --allow-dirty
EOF
}

if [[ -z "$TAG" || "$TAG" == "-h" || "$TAG" == "--help" ]]; then
  usage
  exit 0
fi
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --skip-package) SKIP_PACKAGE=1; shift ;;
    --skip-publish) SKIP_PUBLISH=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --no-skip-tests) SKIP_TESTS=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

cd "$PKG_DIR"

if ! git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Git tag not found: $TAG (create it first with: git tag -a $TAG -m '...')" >&2
  exit 1
fi

# 1. Version pulled from the tag (strip leading 'v').
VERSION="${TAG#v}"
PKG_VERSION=$(node -p "require('./package.json').version")
AGENT_VERSION=$(node -p "require('./agent-package.json').version")
if [[ "$VERSION" != "$PKG_VERSION" || "$VERSION" != "$AGENT_VERSION" ]]; then
  echo "Version mismatch (tag=$VERSION package.json=$PKG_VERSION agent-package.json=$AGENT_VERSION) — auto-syncing..." >&2
  VERSION="$VERSION" TAG="$TAG" PKG_DIR="$(pwd)" node <<'NODE'
  const fs = require("fs");
  const path = require("path");
  const version = process.env.VERSION;
  const tag = process.env.TAG;
  const pkgDir = process.env.PKG_DIR;
  function writeJson(rel, mutate) {
    const file = path.join(pkgDir, rel);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(data);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }
  writeJson("package.json", (j) => { j.version = version; });
  writeJson("config/app-agent.config.json", (j) => {
    if (j.agent) j.agent.version = version;
  });
  writeJson("agent-package.json", (j) => {
    j.version = version;
    if (j.source) {
      j.source.version = version;
      if (typeof j.source.prefix === "string")
        j.source.prefix = j.source.prefix.replace(/\/versions\/[^/]+$/, `/versions/${version}`);
    }
    for (const alt of j.alternativeSources || []) {
      if ("version" in alt) alt.version = version;
      if (typeof alt.path === "string")
        alt.path = alt.path.replace(/deepagents-dev-templates-[^.]+\.tgz$/, `deepagents-dev-templates-${version}.tgz`);
      if (typeof alt.ref === "string" && alt.ref.startsWith("v")) alt.ref = tag;
    }
  });
NODE
fi

# 2. Channel auto-detected by the same rule as publish-s3.sh.
if [[ "$VERSION" =~ - ]]; then
  CHANNEL="beta"
else
  CHANNEL="stable"
fi
echo "Release target: $TAG → version=$VERSION channel=$CHANNEL"

# 3. Working tree cleanliness (only enforced when we'll actually publish).
if [[ "$SKIP_PUBLISH" -eq 0 && "$ALLOW_DIRTY" -eq 0 ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree has uncommitted changes; commit/stash or pass --allow-dirty." >&2
    git status --short
    exit 1
  fi
fi

# 4. Build the artifacts.
if [[ "$SKIP_PACKAGE" -eq 0 ]]; then
  echo
  echo "▶ package.sh"
  PKG_ARGS=(--format all)
  if [[ "$SKIP_TESTS" -eq 1 || "$DRY_RUN" -eq 1 ]]; then
    PKG_ARGS+=(--skip-tests)
  fi
  bash scripts/package.sh "${PKG_ARGS[@]}"

  echo
  echo "▶ package-platforms.sh"
  # Per-platform archives ({agentName}-{os}-{arch}-{version}.{ext}) + platforms.json
  # for nuwax-file-server. --verbose so progress shows up in CI logs.
  AGENT_NAME=$(node -p "require('./agent-package.json').name")
  bash scripts/package-platforms.sh "$AGENT_NAME" "$VERSION" dist-packages --verbose
else
  echo "▶ package.sh (skipped)"
fi

# 5. Publish.
if [[ "$SKIP_PUBLISH" -eq 0 ]]; then
  echo
  echo "▶ publish-s3.sh"
  PUB_ARGS=(--from-tag "$TAG")
  if [[ "$DRY_RUN" -eq 1 ]]; then
    PUB_ARGS+=(--dry-run)
  fi
  bash scripts/publish-s3.sh "${PUB_ARGS[@]}"
else
  echo "▶ publish-s3.sh (skipped)"
fi

echo
echo "Release complete: $TAG (channel=$CHANNEL)"
