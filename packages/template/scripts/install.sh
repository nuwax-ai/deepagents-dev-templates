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
FROM_BUCKET=0
CHANNEL="stable"
NO_VERIFY_SSL=0
AWS_ENDPOINT_OVERRIDE=""
AWS_BUCKET_OVERRIDE=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/install.sh
  bash scripts/install.sh --artifact PATH --install-root DIR [--force]
  bash scripts/install.sh --from-bucket [--channel stable|beta] --install-root DIR [--force]

Options:
  --artifact PATH           Local npm tgz, Nuwax tar.gz, or Nuwax zip artifact
  --install-root DIR        Target install directory
  --force                   Replace an existing install directory
  --from-bucket             Pull the artifact from the MinIO/S3 bucket declared in
                            .nuwax-agent/distribution.json (implies --channel stable)
  --channel <stable|beta>   Channel to resolve when --from-bucket is set (default: stable)
  --no-verify-ssl           Pass through to `aws s3 cp` for self-signed MinIO endpoints
  --aws-endpoint <url>      Override NUWAX_S3_ENDPOINT for this invocation
  --aws-bucket <name>       Override NUWAX_S3_BUCKET for this invocation
  -h, --help                Show help
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
    --from-bucket)
      FROM_BUCKET=1
      shift
      ;;
    --channel)
      CHANNEL="${2:-stable}"
      shift 2
      ;;
    --no-verify-ssl)
      NO_VERIFY_SSL=1
      shift
      ;;
    --aws-endpoint)
      AWS_ENDPOINT_OVERRIDE="${2:-}"
      shift 2
      ;;
    --aws-bucket)
      AWS_BUCKET_OVERRIDE="${2:-}"
      shift 2
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

if [[ "$FROM_BUCKET" -eq 1 && -n "$ARTIFACT" ]]; then
  echo "--from-bucket and --artifact are mutually exclusive" >&2
  exit 1
fi

if [[ "$FROM_BUCKET" -eq 1 && -z "$INSTALL_ROOT" ]]; then
  echo "--install-root is required with --from-bucket" >&2
  exit 1
fi

if [[ -n "$AWS_ENDPOINT_OVERRIDE" ]]; then
  export NUWAX_S3_ENDPOINT="$AWS_ENDPOINT_OVERRIDE"
fi
if [[ -n "$AWS_BUCKET_OVERRIDE" ]]; then
  export NUWAX_S3_BUCKET="$AWS_BUCKET_OVERRIDE"
fi
if [[ "$NO_VERIFY_SSL" -eq 1 ]]; then
  export NUWAX_S3_NO_VERIFY_SSL=1
fi

local_install() {
  local name version
  name=$(node -p "require('$AGENT_PKG').name")
  version=$(node -p "require('$AGENT_PKG').version")
  echo "Installing ${name} v${version} in development checkout..."
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

  do_install_from_artifact "$ARTIFACT" "$INSTALL_ROOT"
}

# Shared body: extract an artifact to INSTALL_TMP, then copy into INSTALL_ROOT
# and finalize (npm install / build / state file).
do_install_from_artifact() {
  local artifact_path="$1"
  local install_root="$2"

  INSTALL_TMP=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-install-XXXXXX")
  trap 'rm -rf "${INSTALL_TMP:-}"' EXIT

  extract_artifact "$artifact_path" "$INSTALL_TMP"
  local root
  root=$(find_extracted_root "$INSTALL_TMP")

  rm -rf "$install_root"
  mkdir -p "$install_root"
  cp -R "$root"/. "$install_root"/

  cd "$install_root"
  if [[ -f "$install_root/dist/bundle.mjs" ]]; then
    # Self-contained esbuild bundle: all production deps are inlined, so there
    # is no node_modules to install and nothing to compile.
    echo "Self-contained esbuild bundle detected; skipping npm install and build."
  else
    if [[ -d "$install_root/node_modules" && -d "$install_root/node_modules/deepagents" ]]; then
      echo "Using bundled node_modules; skipping npm install."
    else
      npm install --omit=dev
    fi

    if [[ ! -f "$install_root/dist/index.js" ]]; then
      npm run build
    fi
  fi

  mkdir -p "$install_root/logs" "$install_root/.nuwax-agent"

  INSTALL_ROOT="$install_root" ARTIFACT="$artifact_path" node <<'NODE'
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

  echo "Installation complete: $install_root"
  if [[ -f "$install_root/dist/bundle.mjs" ]]; then
    echo "Run: node $install_root/dist/bundle.mjs"
  else
    echo "Run: node $install_root/dist/index.js"
  fi
}

bucket_install() {
  if [[ -z "$INSTALL_ROOT" ]]; then
    echo "--install-root is required with --from-bucket" >&2
    exit 1
  fi

  if [[ -e "$INSTALL_ROOT" && "$FORCE" -ne 1 ]]; then
    echo "Install root already exists: $INSTALL_ROOT" >&2
    echo "Use --force to replace it." >&2
    exit 1
  fi

  # shellcheck source=scripts/s3-fetch.sh
  source "$SCRIPT_DIR/s3-fetch.sh"
  s3_load_env

  local tmp_dir
  tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-s3-XXXXXX")
  trap 'rm -rf "$tmp_dir"' EXIT

  local artifact
  if ! artifact=$(s3_fetch_artifact "$CHANNEL" "nuwax-zip" "$tmp_dir"); then
    echo "Failed to fetch artifact for channel '$CHANNEL'" >&2
    exit 1
  fi

  # Copy the downloaded artifact out of tmp_dir BEFORE do_install_from_artifact
  # overwrites the trap with its own INSTALL_TMP cleanup.
  # Preserve extension so extract_artifact can detect the type.
  local ext="${artifact##*.}"
  local artifact_copy="$tmp_dir/.deepagents-artifact.${ext}"
  cp "$artifact" "$artifact_copy"

  do_install_from_artifact "$artifact_copy" "$INSTALL_ROOT"
  # do_install_from_artifact sets its own trap for INSTALL_TMP; tmp_dir is still
  # cleaned up on exit because the outer trap runs on function-scope EXIT and
  # traps are additive when registered with unique variable names (shell keeps
  # the last trap for each variable). We manually clean tmp_dir here as a belt-
  # and-suspenders measure.
  rm -rf "$tmp_dir"
}

if [[ "$FROM_BUCKET" -eq 1 ]]; then
  bucket_install
elif [[ -z "$ARTIFACT" && -z "$INSTALL_ROOT" ]]; then
  local_install
else
  artifact_install
fi
