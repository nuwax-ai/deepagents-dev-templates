#!/usr/bin/env bash
# Install script for local development or Nuwax tar/zip/npm artifacts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(dirname "$SCRIPT_DIR")"
AGENT_PKG="$PKG_DIR/agent-package.json"

ARTIFACT=""
INSTALL_ROOT=""
FORCE=0
INSTALL_TMP=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/install.sh
  bash scripts/install.sh --artifact PATH --install-root DIR [--force]

Options:
  --artifact PATH      npm tgz, Nuwax tar.gz, or Nuwax zip artifact
  --install-root DIR   Target install directory
  --force              Replace an existing install directory
  -h, --help           Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT="${2:-}"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="${2:-}"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

NAME=$(node -p "require('$AGENT_PKG').name")
VERSION=$(node -p "require('$AGENT_PKG').version")

local_install() {
  echo "Installing ${NAME} v${VERSION} in development checkout..."
  cd "$PKG_DIR"
  npm install --production

  if [[ ! -f "$PKG_DIR/dist/index.js" ]]; then
    npm run build
  fi

  if [[ -z "${ANTHROPIC_API_KEY:-}" && -z "${ANTHROPIC_AUTH_TOKEN:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
    echo "Warning: no LLM credentials found. Set OPENAI_API_KEY or an Anthropic credential."
  fi

  echo "Installation complete."
  echo "Run: npm run start:acp"
}

extract_artifact() {
  local artifact="$1"
  local dest="$2"

  case "$artifact" in
    *.zip)
      unzip -q "$artifact" -d "$dest"
      ;;
    *.tar.gz|*.tgz)
      tar -xzf "$artifact" -C "$dest"
      ;;
    *)
      echo "Unsupported artifact type: $artifact" >&2
      exit 1
      ;;
  esac
}

find_extracted_root() {
  local dir="$1"
  local package_json
  package_json=$(find "$dir" -maxdepth 3 -name package.json -print -quit)
  if [[ -z "$package_json" ]]; then
    echo "No package.json found in artifact" >&2
    exit 1
  fi
  dirname "$package_json"
}

artifact_install() {
  if [[ -z "$ARTIFACT" || -z "$INSTALL_ROOT" ]]; then
    echo "--artifact and --install-root are required for artifact install" >&2
    usage >&2
    exit 1
  fi

  if [[ ! -f "$ARTIFACT" ]]; then
    echo "Artifact not found: $ARTIFACT" >&2
    exit 1
  fi

  if [[ -e "$INSTALL_ROOT" && "$FORCE" -ne 1 ]]; then
    echo "Install root already exists: $INSTALL_ROOT" >&2
    echo "Use --force to replace it." >&2
    exit 1
  fi

  INSTALL_TMP=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-install-XXXXXX")
  trap 'rm -rf "${INSTALL_TMP:-}"' EXIT

  extract_artifact "$ARTIFACT" "$INSTALL_TMP"
  local root
  root=$(find_extracted_root "$INSTALL_TMP")

  rm -rf "$INSTALL_ROOT"
  mkdir -p "$INSTALL_ROOT"
  cp -R "$root"/. "$INSTALL_ROOT"/

  cd "$INSTALL_ROOT"
  npm install --omit=dev

  if [[ ! -f "$INSTALL_ROOT/dist/index.js" ]]; then
    npm run build
  fi

  mkdir -p "$INSTALL_ROOT/logs" "$INSTALL_ROOT/.nuwax-agent"

  INSTALL_ROOT="$INSTALL_ROOT" ARTIFACT="$ARTIFACT" node <<'NODE'
const fs = require("fs");
const path = require("path");

const installRoot = process.env.INSTALL_ROOT;
const artifact = process.env.ARTIFACT;
const pkg = JSON.parse(fs.readFileSync(path.join(installRoot, "package.json"), "utf8"));

const state = {
  schema: "nuwax.agent.install-state.v1",
  packageName: pkg.name,
  version: pkg.version,
  installRoot,
  artifact: path.basename(artifact),
  installedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(installRoot, ".nuwax-agent", "install-state.json"), JSON.stringify(state, null, 2) + "\n");
NODE

  echo "Installation complete: $INSTALL_ROOT"
  echo "Run: node $INSTALL_ROOT/dist/index.js"
}

if [[ -z "$ARTIFACT" && -z "$INSTALL_ROOT" ]]; then
  local_install
else
  artifact_install
fi
