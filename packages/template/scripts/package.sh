#!/usr/bin/env bash
# Package script for npm tgz plus Nuwax tar/zip artifacts.
set -euo pipefail

FORMAT="all"
OUT_DIR="dist-packages"
SKIP_TESTS=0
VERSION=""
BUNDLE_NODE_MODULES=1

usage() {
  cat <<'EOF'
Usage: bash scripts/package.sh [options]

Options:
  --format all|npm-tgz|tgz|tar|zip   Artifact format to build (default: all)
  --out DIR                          Output directory (default: dist-packages)
  --version VERSION                  Override package version metadata
  --skip-tests                       Build without running tests
  --no-bundle-node-modules           Use legacy vendored node_modules instead of the esbuild bundle
  -h, --help                         Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      FORMAT="${2:-}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS=1
      shift
      ;;
    --no-bundle-node-modules)
      BUNDLE_NODE_MODULES=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$VERSION" && "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
        VERSION="$1"
        shift
      else
        echo "Unknown option: $1" >&2
        usage >&2
        exit 1
      fi
      ;;
  esac
done

case "$FORMAT" in
  all|npm-tgz|tgz|tar|zip) ;;
  *)
    echo "Invalid --format: $FORMAT" >&2
    exit 1
    ;;
esac

PKG_NAME=$(node -p "require('./package.json').name")
AGENT_NAME=$(node -p "require('./agent-package.json').name")
VERSION=${VERSION:-$(node -p "require('./package.json').version")}
AGENT_VERSION=$(node -p "require('./agent-package.json').version")
NPM_CACHE=${NPM_CONFIG_CACHE:-${TMPDIR:-/tmp}/deepagents-app-ts-npm-cache}
OUT_DIR=$(mkdir -p "$OUT_DIR" && cd "$OUT_DIR" && pwd)
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-package-XXXXXX")
STAGE_ROOT="$STAGING_DIR/${PKG_NAME}-${VERSION}"
ARTIFACTS=()

cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

if [[ "$VERSION" != "$AGENT_VERSION" ]]; then
  echo "Version mismatch: package.json=$VERSION agent-package.json=$AGENT_VERSION" >&2
  exit 1
fi

echo "Packaging ${PKG_NAME} v${VERSION}"

bash scripts/build.sh

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  echo ""
  echo "Running tests..."
  npm test
else
  echo "Skipping tests by request."
fi

echo ""
echo "Preparing staging directory..."
mkdir -p "$STAGE_ROOT"
rsync -a \
  --exclude ".git/" \
  --exclude ".github/" \
  --exclude ".idea/" \
  --exclude ".vscode/" \
  --exclude ".DS_Store" \
  --exclude "node_modules/" \
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

find "$STAGE_ROOT" -type f \( \
  -name "*.tgz" -o \
  -name "*.tar.gz" -o \
  -name "*.zip" -o \
  -name "agent-package.release.json" \
\) -delete

if [[ "$BUNDLE_NODE_MODULES" -eq 1 ]]; then
  echo ""
  echo "Bundling runnable agent into staging dist/bundle.mjs (esbuild)..."
  # The deployable artifact ships a single self-contained bundle instead of the
  # full production node_modules tree. Drop the tsc dist/ that rsync copied and
  # replace it with just the esbuild bundle. The bundle is built from the real
  # package src/ (cwd), written into the staging dir.
  rm -rf "$STAGE_ROOT/dist"
  ENTRY="src/index.ts" bash scripts/bundle.sh "$STAGE_ROOT/dist/bundle.mjs"
else
  echo ""
  echo "Vendoring production node_modules (legacy --no-bundle-node-modules)..."
  (cd "$STAGE_ROOT" && npm --cache "$NPM_CACHE" install --omit=dev --no-package-lock)
fi

node - "$STAGE_ROOT" "$VERSION" "$PKG_NAME" "$AGENT_NAME" "$BUNDLE_NODE_MODULES" <<'NODE'
const fs = require("fs");
const path = require("path");

const [root, version, packageName, agentName, bundleNodeModules] = process.argv.slice(2);
const generatedAt = new Date().toISOString();
// "1" → esbuild single-file bundle (default); "0" → legacy vendored node_modules.
const esbuildBundle = bundleNodeModules === "1";
const bundleStrategy = esbuildBundle ? "esbuild-bundle" : "vendored-node-modules";

const versionJson = {
  schema: "nuwax.agent.version.v1",
  packageName,
  agentName,
  version,
  generatedAt,
  bundleStrategy,
};

const platformJson = {
  schema: "nuwax.agent.platform.v1",
  packageName,
  agentName,
  version,
  entrypoints: {
    server: esbuildBundle ? "dist/bundle.mjs" : "dist/index.js",
    graph: esbuildBundle ? "dist/bundle.mjs graph" : "dist/index.js graph",
  },
  dependencies: {
    strategy: bundleStrategy,
    nodeModules: esbuildBundle ? "none" : "bundled",
    installCommand: esbuildBundle ? null : "npm install --omit=dev",
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

cp "$STAGE_ROOT/.version.json" "$OUT_DIR/${AGENT_NAME}-${VERSION}.version.json"
cp "$STAGE_ROOT/.platform.json" "$OUT_DIR/${AGENT_NAME}-${VERSION}.platform.json"

build_npm_tgz() {
  echo ""
  echo "Creating npm tgz..."
  rm -f "$OUT_DIR/${PKG_NAME}-${VERSION}.tgz"
  local pack_output
  pack_output=$(npm --cache "$NPM_CACHE" pack --pack-destination "$OUT_DIR")
  local tarball
  tarball=$(basename "$pack_output" | tail -1)
  if [[ ! -f "$OUT_DIR/$tarball" ]]; then
    echo "Failed to create npm tgz" >&2
    exit 1
  fi
  ARTIFACTS+=("$OUT_DIR/$tarball")
  cp "$OUT_DIR/$tarball" "./$tarball"
  echo "Created $OUT_DIR/$tarball"
}

build_tar() {
  echo ""
  echo "Creating Nuwax tar.gz..."
  local artifact="$OUT_DIR/${AGENT_NAME}-${VERSION}-nuwax.tar.gz"
  rm -f "$artifact"
  tar -C "$STAGING_DIR" -czf "$artifact" "${PKG_NAME}-${VERSION}"
  ARTIFACTS+=("$artifact")
  echo "Created $artifact"
}

build_zip() {
  echo ""
  echo "Creating Nuwax zip..."
  local artifact="$OUT_DIR/${AGENT_NAME}-${VERSION}-nuwax.zip"
  rm -f "$artifact"
  (cd "$STAGING_DIR" && zip -qr "$artifact" "${PKG_NAME}-${VERSION}")
  ARTIFACTS+=("$artifact")
  echo "Created $artifact"
}

case "$FORMAT" in
  all)
    build_npm_tgz
    build_tar
    build_zip
    ;;
  npm-tgz|tgz)
    build_npm_tgz
    ;;
  tar)
    build_tar
    ;;
  zip)
    build_zip
    ;;
esac

echo ""
echo "Writing release metadata..."

node - "$OUT_DIR" "$VERSION" "$PKG_NAME" "$AGENT_NAME" "${ARTIFACTS[@]}" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const [outDir, version, packageName, agentName, ...artifacts] = process.argv.slice(2);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const artifactRecords = artifacts.map((file) => ({
  file: path.basename(file),
  type: file.endsWith(".zip") ? "nuwax-zip" : file.endsWith(".tar.gz") ? "nuwax-tar" : "npm-tgz",
  sha256: sha256(file),
}));

const checksums = {
  schema: "nuwax.agent.package-checksums.v1",
  packageName,
  version,
  artifacts: artifactRecords,
};

const baseManifest = JSON.parse(fs.readFileSync("agent-package.json", "utf8"));
const primary = artifactRecords[0];
const release = {
  ...baseManifest,
  version,
  source: primary
    ? {
        type: primary.type,
        path: `./${primary.file}`,
        version,
      }
    : baseManifest.source,
  checksum: primary
    ? {
        algorithm: "sha256",
        value: primary.sha256,
      }
    : baseManifest.checksum,
  artifacts: artifactRecords,
  platform: {
    schema: "nuwax.agent.platform.v1",
    path: ".platform.json",
  },
};

fs.writeFileSync(path.join(outDir, "package-checksums.json"), JSON.stringify(checksums, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "agent-package.release.json"), JSON.stringify(release, null, 2) + "\n");
fs.writeFileSync("agent-package.release.json", JSON.stringify(release, null, 2) + "\n");
NODE

echo "Wrote $OUT_DIR/agent-package.release.json"
echo "Wrote $OUT_DIR/package-checksums.json"
echo ""
echo "Package artifacts:"
for artifact in "${ARTIFACTS[@]}"; do
  shasum -a 256 "$artifact"
done
