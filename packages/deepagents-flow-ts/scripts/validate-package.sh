#!/usr/bin/env bash
# Validate generated package artifacts and optional checksum metadata.
set -euo pipefail

ARTIFACT=""
CHECKSUMS=""
REQUIRE_NODE_MODULES=0

usage() {
  cat <<'EOF'
Usage: bash scripts/validate-package.sh --artifact PATH [--checksums package-checksums.json]

Options:
  --artifact PATH      Artifact to validate
  --checksums PATH         Optional checksum manifest
  --require-node-modules   Require bundled node_modules in the artifact
  -h, --help               Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact)
      ARTIFACT="${2:-}"
      shift 2
      ;;
    --checksums)
      CHECKSUMS="${2:-}"
      shift 2
      ;;
    --require-node-modules)
      REQUIRE_NODE_MODULES=1
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

if [[ -z "$ARTIFACT" || ! -f "$ARTIFACT" ]]; then
  echo "--artifact must point to an existing file" >&2
  exit 1
fi

case "$ARTIFACT" in
  *.zip)
    unzip -tq "$ARTIFACT" >/dev/null
    ;;
  *.tar.gz|*.tgz)
    tar -tzf "$ARTIFACT" >/dev/null
    ;;
  *)
    echo "Unsupported artifact type: $ARTIFACT" >&2
    exit 1
    ;;
esac

if [[ "$REQUIRE_NODE_MODULES" -eq 1 ]]; then
  entries=""
  case "$ARTIFACT" in
    *.zip)
      entries=$(unzip -Z1 "$ARTIFACT")
      if ! grep -q '/node_modules/deepagents/' <<<"$entries"; then
        echo "Bundled node_modules missing from artifact: $ARTIFACT" >&2
        exit 1
      fi
      ;;
    *.tar.gz|*.tgz)
      entries=$(tar -tzf "$ARTIFACT")
      if ! grep -q '/node_modules/deepagents/' <<<"$entries"; then
        echo "Bundled node_modules missing from artifact: $ARTIFACT" >&2
        exit 1
      fi
      ;;
  esac
fi

if [[ -n "$CHECKSUMS" ]]; then
  if [[ ! -f "$CHECKSUMS" ]]; then
    echo "Checksum manifest not found: $CHECKSUMS" >&2
    exit 1
  fi

  ARTIFACT="$ARTIFACT" CHECKSUMS="$CHECKSUMS" node <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const artifact = process.env.ARTIFACT;
const checksums = JSON.parse(fs.readFileSync(process.env.CHECKSUMS, "utf8"));
const record = checksums.artifacts.find((item) => item.file === path.basename(artifact));

if (!record) {
  throw new Error(`No checksum record for ${path.basename(artifact)}`);
}

const actual = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
if (actual !== record.sha256) {
  throw new Error(`Checksum mismatch for ${path.basename(artifact)}`);
}
NODE
fi

echo "Package validation passed: $ARTIFACT"
