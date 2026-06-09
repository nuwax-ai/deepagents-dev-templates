#!/usr/bin/env bash
# 本地一键发布：改版本号 → commit → tag → 打包 → 推 S3（stable / beta）
#
# S3 目录约定（见 .nuwax-agent/distribution.json）：
#   agent-engines/deepagents-app-ts/versions/<version>/...
#   agent-engines/deepagents-app-ts/channels/stable.json   ← 仅 stable 发布时更新
#   agent-engines/deepagents-app-ts/channels/beta.json     ← 仅 beta 发布时更新
#   agent-engines/deepagents-app-ts/latest.json            ← 仅 stable 发布时更新
#
# Channel 与版本号：
#   stable  版本形如 0.2.2        tag: v0.2.2
#   beta    版本含预发布后缀       tag: v0.2.2-beta.1 | v0.3.0-rc.1 等
#
# 示例：
#   set -a && source .env && set +a
#   bash scripts/local-release.sh --channel stable --version 0.2.2
#   bash scripts/local-release.sh --channel beta --base 0.2.2
#   bash scripts/local-release.sh --channel beta --version 0.2.2-rc.1 --dry-run
#
# Requires: bash, git, node, aws cli (发布时), jq.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"

CHANNEL=""
VERSION=""
BASE=""
BUMP=""
DRY_RUN=0
SKIP_PUBLISH=0
SKIP_TESTS=1
SKIP_COMMIT=0
SKIP_TAG=0
PRUNE=0
ALLOW_DIRTY=0
LOAD_ENV=1

usage() {
  cat <<'EOF'
Usage:
  bash scripts/local-release.sh --channel stable|beta [version options] [flags]

Version (pick one):
  --version VERSION     完整版本号（stable: 0.2.2；beta: 0.2.2-beta.1 / 0.3.0-rc.1）
  --bump patch|minor|major   从 package.json 当前版本递增（仅 stable）
  --base X.Y.Z          beta：自动取下一个 X.Y.Z-beta.N（查已有 git tag）

Flags:
  --dry-run             只打印计划，不改文件、不打 tag、不传 S3
  --skip-publish        只 bump + commit + tag + 打包，不上传
  --skip-tests          打包时跳过 vitest（默认开启）
  --no-skip-tests       打包时运行 vitest
  --skip-commit         不 git commit 版本号改动
  --skip-tag            不创建 git tag
  --prune               上传前删除 S3 同版本目录下旧对象
  --allow-dirty         允许工作区有其他未提交改动
  --no-load-env         不自动 source 包目录下的 .env
  -h, --help            显示帮助

Examples:
  bash scripts/local-release.sh --channel stable --version 0.2.2
  bash scripts/local-release.sh --channel stable --bump patch
  bash scripts/local-release.sh --channel beta --base 0.2.2
  bash scripts/local-release.sh --channel beta --version 0.2.2-rc.1 --prune
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --version) VERSION="${2:-}"; shift 2 ;;
    --base) BASE="${2:-}"; shift 2 ;;
    --bump) BUMP="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-publish) SKIP_PUBLISH=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --no-skip-tests) SKIP_TESTS=0; shift ;;
    --skip-commit) SKIP_COMMIT=1; shift ;;
    --skip-tag) SKIP_TAG=1; shift ;;
    --prune) PRUNE=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --no-load-env) LOAD_ENV=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

cd "$PKG_DIR"

if [[ -z "$CHANNEL" ]]; then
  echo "Missing --channel stable|beta" >&2
  usage >&2
  exit 1
fi

if [[ "$CHANNEL" != "stable" && "$CHANNEL" != "beta" ]]; then
  echo "Unsupported channel: $CHANNEL (expected stable|beta)" >&2
  exit 1
fi

# ─── 解析目标版本号 ───────────────────────────────────────────

semver_bump() {
  local kind="$1"
  local current="$2"
  if [[ ! "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    echo "Cannot bump non-stable version: $current (use --version)" >&2
    exit 1
  fi
  local major="${BASH_REMATCH[1]}"
  local minor="${BASH_REMATCH[2]}"
  local patch="${BASH_REMATCH[3]}"
  case "$kind" in
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    major) echo "$((major + 1)).0.0" ;;
    *) echo "Invalid --bump: $kind (expected patch|minor|major)" >&2; exit 1 ;;
  esac
}

next_beta_version() {
  local base="$1"
  if [[ ! "$base" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Invalid --base: $base (expected X.Y.Z)" >&2
    exit 1
  fi
  local max=0
  local tag ver n
  while IFS= read -r tag; do
    ver="${tag#v}"
    if [[ "$ver" =~ ^${base}-beta\.([0-9]+)$ ]]; then
      n="${BASH_REMATCH[1]}"
      if (( n > max )); then max=$n; fi
    fi
  done < <(git tag -l "v${base}-beta.*" 2>/dev/null || true)
  echo "${base}-beta.$((max + 1))"
}

resolve_version() {
  if [[ -n "$VERSION" ]]; then
    printf '%s' "$VERSION"
    return
  fi
  if [[ -n "$BUMP" ]]; then
    if [[ "$CHANNEL" != "stable" ]]; then
      echo "--bump is only for stable; use --base or --version for beta" >&2
      exit 1
    fi
    semver_bump "$BUMP" "$(node -p "require('./package.json').version")"
    return
  fi
  if [[ -n "$BASE" ]]; then
    if [[ "$CHANNEL" != "beta" ]]; then
      echo "--base is only for beta channel" >&2
      exit 1
    fi
    next_beta_version "$BASE"
    return
  fi
  echo "Specify --version, --bump (stable), or --base (beta)" >&2
  exit 1
}

VERSION="$(resolve_version)"
TAG="v${VERSION}"

# channel 与版本号必须一致
if [[ "$CHANNEL" == "stable" ]]; then
  if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Stable channel requires X.Y.Z, got: $VERSION" >&2
    exit 1
  fi
else
  if [[ ! "$VERSION" =~ - ]]; then
    echo "Beta channel requires a pre-release version (e.g. 0.2.2-beta.1), got: $VERSION" >&2
    exit 1
  fi
fi

echo "Local release plan"
echo "  channel:  $CHANNEL"
echo "  version:  $VERSION"
echo "  tag:      $TAG"
echo "  s3 path:  agent-engines/deepagents-app-ts/versions/$VERSION/"
echo "  pointer:  channels/${CHANNEL}.json"
if [[ "$CHANNEL" == "stable" ]]; then
  echo "  also:     latest.json"
fi
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] Would bump package.json, agent-package.json, config/app-agent.config.json"
  echo "[dry-run] Would commit, tag $TAG, package, publish-s3.sh --from-tag $TAG"
  exit 0
fi

if [[ "$ALLOW_DIRTY" -eq 0 ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree has uncommitted changes; commit/stash or pass --allow-dirty." >&2
  git status --short
  exit 1
fi

if git rev-parse --verify "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Git tag already exists: $TAG" >&2
  exit 1
fi

# ─── 写入版本号 ───────────────────────────────────────────────

VERSION="$VERSION" TAG="$TAG" PKG_DIR="$PKG_DIR" node <<'NODE'
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

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
const agentName = JSON.parse(fs.readFileSync(path.join(pkgDir, "agent-package.json"), "utf8")).name;

writeJson("package.json", (j) => { j.version = version; j.name = agentName; });

writeJson("config/app-agent.config.json", (j) => {
  if (j.agent) { j.agent.version = version; j.agent.name = agentName; }
});

writeJson("agent-package.json", (j) => {
  j.version = version;
  if (j.source) {
    j.source.version = version;
    if (typeof j.source.prefix === "string") {
      j.source.prefix = j.source.prefix.replace(/\/versions\/[^/]+$/, `/versions/${version}`);
    }
  }
  for (const alt of j.alternativeSources || []) {
    if ("version" in alt) alt.version = version;
    if ("package" in alt) alt.package = agentName;
    if (typeof alt.path === "string") {
      alt.path = alt.path.replace(new RegExp(esc(agentName) + "[^.]+\\.tgz$"), `${agentName}-${version}.tgz`);
    }
    if (typeof alt.ref === "string" && alt.ref.startsWith("v")) alt.ref = tag;
  }
});
NODE

echo "▶ Version files updated to $VERSION"

# ─── commit & tag ─────────────────────────────────────────────

if [[ "$SKIP_COMMIT" -eq 0 ]]; then
  git add package.json agent-package.json config/app-agent.config.json
  git commit -m "$(cat <<EOF
chore(release): bump version to ${VERSION}

Channel: ${CHANNEL}
EOF
)"
  echo "▶ Committed version bump"
else
  echo "▶ commit (skipped)"
fi

if [[ "$SKIP_TAG" -eq 0 ]]; then
  git tag -a "$TAG" -m "Release ${VERSION} (${CHANNEL})"
  echo "▶ Tagged $TAG"
else
  echo "▶ tag (skipped)"
fi

# ─── 打包 ─────────────────────────────────────────────────────

echo
echo "▶ package.sh"
PKG_ARGS=(--format all)
if [[ "$SKIP_TESTS" -eq 1 ]]; then
  PKG_ARGS+=(--skip-tests)
fi
bash scripts/package.sh "${PKG_ARGS[@]}"

bash scripts/validate-package.sh \
  --artifact "dist-packages/deepagents-dev-templates-${VERSION}-nuwax.zip" \
  --require-node-modules

# ─── 发布 S3 ──────────────────────────────────────────────────

if [[ "$SKIP_PUBLISH" -eq 0 ]]; then
  if [[ "$LOAD_ENV" -eq 1 && -f "$PKG_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$PKG_DIR/.env"
    set +a
    echo "▶ Loaded $PKG_DIR/.env"
  fi

  echo
  echo "▶ publish-s3.sh"
  PUB_ARGS=(--from-tag "$TAG" --channel "$CHANNEL")
  if [[ "$PRUNE" -eq 1 ]]; then
    PUB_ARGS+=(--prune)
  fi
  bash scripts/publish-s3.sh "${PUB_ARGS[@]}"
else
  echo "▶ publish-s3.sh (skipped)"
fi

echo
echo "Local release complete: $TAG → channel=$CHANNEL"
echo "  Install (beta):  bash scripts/install.sh --from-bucket --channel beta --install-root <dir>"
echo "  Install (stable): bash scripts/install.sh --from-bucket --channel stable --install-root <dir>"
