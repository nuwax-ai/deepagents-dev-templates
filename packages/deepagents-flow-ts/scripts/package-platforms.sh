#!/usr/bin/env bash
# Package the runnable agent into per-platform archives named
#   {agentName}-{os}-{arch}-{version}.{ext}
# matching the nuwax-file-server platform-key contract (OpenAPI `PlatformEntry`:
# platform key format is `{os}-{arch}`, e.g. linux-x86_64, darwin-arm64).
#
# The runtime is a single self-contained esbuild bundle (pure JS, --platform=node),
# so every platform archive has IDENTICAL content and differs only by filename.
# Alongside the archives we emit `{agentName}-{version}.platforms.json` — the
# `InstallFromUrlRequest.platforms` map ({ file, sha256, size, url? }) that the
# file-server consumes via POST /agent-mgmt/agents/install-from-url.
#
# OUTPUT CONTRACT (so nuwax-file-server can capture failures cleanly):
#   - Default is QUIET: nothing is printed on success.
#   - Errors always go to stderr (prefixed `ERROR:`).
#   - The exit code is the result: 0 = success, non-zero = failure.
#   - Pass -v/--verbose to stream progress to stderr (stdout stays clean).
#   - Pass --print-artifacts to print produced paths to stdout (one per line).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PKG_DIR"

# ─── Ensure dependencies are installed ───
# If node_modules is missing (or stale), install via pnpm before building.
# We detect pnpm on PATH; fall back to npm if unavailable.
if ! node -e "require('esbuild')" 2>/dev/null; then
  if command -v pnpm >/dev/null 2>&1; then
    log "Installing dependencies with pnpm …"
    run pnpm install --frozen-lockfile 2>/dev/null || run pnpm install
  elif command -v npm >/dev/null 2>&1; then
    log "Installing dependencies with npm …"
    run npm install
  else
    err "Neither pnpm nor npm found on PATH; cannot install dependencies"
    exit 1
  fi
fi

# macOS bsdtar: don't embed AppleDouble (._*) / xattr cruft in the tarball.
export COPYFILE_DISABLE=1

VERBOSE="${VERBOSE:-0}"
PRINT_ARTIFACTS=0
POSITIONAL=()

# Platform matrix: "<os>-<arch>:<ext>". The "<os>-<arch>" segment is used
# verbatim as both the filename platform segment AND the platforms.json key,
# so it MUST equal the file-server platform key. Edit here to add/remove a
# platform (single source of truth).
PLATFORMS=(
  "linux-x86_64:tar.gz"
  "linux-arm64:tar.gz"
  "darwin-arm64:tar.gz"
  "darwin-x86_64:tar.gz"
  "windows-x86_64:zip"
)

# log() — progress, only in verbose mode, always to stderr (never stdout).
log() { [[ "$VERBOSE" == "1" ]] && printf '%s\n' "$*" >&2 || true; }
# err() — errors, always to stderr.
err() { printf 'ERROR: %s\n' "$*" >&2; }

# run() — run a child command honoring the quiet/verbose contract: discard its
# stdout (quiet) or fold it into stderr (verbose); stderr is ALWAYS preserved so
# real failures bubble up to the caller.
run() {
  if [[ "$VERBOSE" == "1" ]]; then
    "$@" >&2
  else
    "$@" >/dev/null
  fi
}

usage() {
  cat <<'EOF'
Usage: bash scripts/package-platforms.sh [agentName] [version] [outDir] [options]

Positional (all optional; sensible defaults):
  agentName   default: agent-package.json .name   (e.g. deepagents-app-ts)
  version     default: package.json .version       (e.g. 0.2.10)
  outDir      default: dist-packages

Options:
  -v, --verbose          Stream progress to stderr (default: quiet)
  -q, --quiet            Quiet mode (default)
      --print-artifacts  Print produced artifact paths to stdout (one per line)
  -h, --help             Show this help

Env:
  NUWAX_ARTIFACT_BASE_URL   If set, platforms.json `url` = {base}/{filename}

Produces, in outDir:
  {agentName}-{os}-{arch}-{version}.{tar.gz|zip}   (one per platform)
  {agentName}-{version}.platforms.json             (install-from-url map)

Default is QUIET: on success nothing is printed; errors go to stderr; the
exit code is the contract (0 = ok, non-zero = failure).
EOF
}

# ─── Parse args (flags may appear anywhere; positionals fill agentName/version/outDir) ───
while [[ $# -gt 0 ]]; do
  case "$1" in
    -v|--verbose) VERBOSE=1; shift ;;
    -q|--quiet) VERBOSE=0; shift ;;
    --print-artifacts) PRINT_ARTIFACTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; while [[ $# -gt 0 ]]; do POSITIONAL+=("$1"); shift; done ;;
    -*) err "Unknown option: $1"; exit 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done

AGENT_NAME="${POSITIONAL[0]:-}"
VERSION="${POSITIONAL[1]:-}"
OUT_DIR="${POSITIONAL[2]:-}"

# ─── Resolve defaults from manifests ───
AGENT_NAME="${AGENT_NAME:-$(node -p "require('./agent-package.json').name" 2>/dev/null || true)}"
VERSION="${VERSION:-$(node -p "require('./package.json').version" 2>/dev/null || true)}"
OUT_DIR="${OUT_DIR:-dist-packages}"
PKG_NAME="$(node -p "require('./package.json').name" 2>/dev/null || true)"

# ─── Validate ───
if [[ ! "$AGENT_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  err "invalid agentName: '${AGENT_NAME}' (allowed: letters, digits, . _ -; could not derive from agent-package.json)"
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  err "invalid version: '${VERSION}' (expected x.y.z or x.y.z-pre)"
  exit 1
fi

mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# ─── Staging ───
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nuwax-platforms-XXXXXX")"
STAGE_ROOT="$STAGING_DIR/${AGENT_NAME}-${VERSION}"
cleanup() { rm -rf "$STAGING_DIR"; }
trap cleanup EXIT
trap 'err "package-platforms failed (line $LINENO)"' ERR

log "Packaging ${AGENT_NAME} v${VERSION} -> ${OUT_DIR}"
mkdir -p "$STAGE_ROOT"

# Copy the runnable content (same exclude list as scripts/package.sh). dist/ is
# excluded because we replace it with the esbuild bundle below; node_modules/ is
# excluded because the bundle is self-contained.
log "Staging runnable content"
run rsync -a \
  --exclude ".git/" \
  --exclude ".github/" \
  --exclude ".idea/" \
  --exclude ".vscode/" \
  --exclude ".DS_Store" \
  --exclude "node_modules/" \
  --exclude "dist/" \
  --exclude "dist-packages/" \
  --exclude "logs/" \
  --exclude "coverage/" \
  --exclude "src/" \
  --exclude "tests/" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".env.example" \
  --exclude ".gitignore" \
  --exclude ".version.json" \
  --exclude ".platform.json" \
  --exclude "agent-package.release.json" \
  --exclude "package-lock.json" \
  --exclude "code-graph.json" \
  --exclude "tsconfig.json" \
  --exclude "tsconfig.*.json" \
  --exclude "vitest.config.*" \
  --exclude "CLAUDE.md" \
  --exclude "QUICKSTART.md" \
  --exclude "*.tgz" \
  --exclude "*.tar.gz" \
  --exclude "*.zip" \
  --exclude "*.log" \
  --exclude "*.local.json" \
  --exclude "*.tsbuildinfo" \
  --exclude "*.map" \
  --exclude "*.tmp" \
  ./ "$STAGE_ROOT"/

# Belt-and-suspenders: drop any release residue rsync may have copied.
find "$STAGE_ROOT" -type f \( \
  -name "*.tgz" -o \
  -name "*.tar.gz" -o \
  -name "*.zip" -o \
  -name "agent-package.release.json" \
\) -delete

# The deployable runtime: one self-contained esbuild bundle (replaces dist/).
log "Bundling esbuild -> dist/bundle.mjs"
ENTRY="src/index.ts" run bash scripts/bundle.sh "$STAGE_ROOT/dist/bundle.mjs"

# In-package metadata, same shape as scripts/package.sh (esbuild-bundle strategy).
# Note: .platform.json keeps the template's internal node-arch vocabulary
# (arch: arm64/x64) for nuwaclaw consumers; the file-server platform keys
# (x86_64) live in the archive filenames and platforms.json below.
log "Writing in-package .version.json / .platform.json"
node - "$STAGE_ROOT" "$VERSION" "$PKG_NAME" "$AGENT_NAME" <<'NODE'
const fs = require("fs");
const path = require("path");
const [root, version, packageName, agentName] = process.argv.slice(2);
const generatedAt = new Date().toISOString();

const versionJson = {
  schema: "nuwax.agent.version.v1",
  packageName,
  agentName,
  version,
  generatedAt,
  bundleStrategy: "esbuild-bundle",
};

const platformJson = {
  schema: "nuwax.agent.platform.v1",
  packageName,
  agentName,
  version,
  entrypoints: {
    server: "dist/bundle.mjs",
    graph: "dist/bundle.mjs graph",
  },
  dependencies: {
    strategy: "esbuild-bundle",
    nodeModules: "none",
    installCommand: null,
  },
  config: {
    panel: ".nuwax-agent/panel.config.json",
    lifecycle: ".nuwax-agent/lifecycle.json",
    placeholders: ".nuwax-agent/placeholders.json",
    package: ".nuwax-agent/package.config.json",
  },
  platforms: [
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "arm64" },
  ],
};

fs.writeFileSync(path.join(root, ".version.json"), JSON.stringify(versionJson, null, 2) + "\n");
fs.writeFileSync(path.join(root, ".platform.json"), JSON.stringify(platformJson, null, 2) + "\n");
NODE

# ─── Build one archive per platform (identical content, per-platform name) ───
ARTIFACTS=()
PAIRS=()
for entry in "${PLATFORMS[@]}"; do
  key="${entry%%:*}"   # e.g. linux-x86_64
  ext="${entry##*:}"   # tar.gz | zip
  artifact="${OUT_DIR}/${AGENT_NAME}-${key}-${VERSION}.${ext}"
  rm -f "$artifact"
  log "Creating $(basename "$artifact")"
  case "$ext" in
    tar.gz)
      # `gzip -n` omits the timestamp/name from the gzip header so identical
      # content yields identical bytes — the same-content platform archives get
      # the same sha256 within a run. pipefail (set above) propagates tar errors.
      tar -C "$STAGING_DIR" -cf - "${AGENT_NAME}-${VERSION}" | gzip -n > "$artifact"
      ;;
    zip)
      ( cd "$STAGING_DIR" && run zip -qr "$artifact" "${AGENT_NAME}-${VERSION}" )
      ;;
    *)
      err "unsupported archive ext: $ext"
      exit 1
      ;;
  esac
  ARTIFACTS+=("$artifact")
  PAIRS+=("${key}=${artifact}")
done

# ─── Emit the platforms.json (install-from-url map + machine-readable manifest) ───
PLATFORMS_JSON="${OUT_DIR}/${AGENT_NAME}-${VERSION}.platforms.json"
log "Writing $(basename "$PLATFORMS_JSON")"
node - "$PLATFORMS_JSON" "$AGENT_NAME" "$VERSION" "${PAIRS[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const [out, agentName, version, ...pairs] = process.argv.slice(2);
const base = (process.env.NUWAX_ARTIFACT_BASE_URL || "").replace(/\/+$/, "");

const platforms = {};
for (const pair of pairs) {
  const i = pair.indexOf("=");
  const key = pair.slice(0, i);
  const file = pair.slice(i + 1);
  const buf = fs.readFileSync(file);
  const record = {
    file: path.basename(file),
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
  };
  // PlatformEntry.url is required by the file-server; only fillable once an
  // artifact base URL is known (publish step). Left out locally.
  if (base) record.url = `${base}/${path.basename(file)}`;
  platforms[key] = record;
}

const doc = {
  schema: "nuwax.agent.platforms.v1",
  agentName,
  version,
  platforms,
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
NODE

# ─── Result ───
if [[ "$PRINT_ARTIFACTS" == "1" ]]; then
  for a in "${ARTIFACTS[@]}"; do printf '%s\n' "$a"; done
  printf '%s\n' "$PLATFORMS_JSON"
fi
log "Done: ${#ARTIFACTS[@]} archives + $(basename "$PLATFORMS_JSON") in ${OUT_DIR}"
exit 0
