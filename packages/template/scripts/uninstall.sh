#!/usr/bin/env bash
# Uninstall a local Nuwax agent install, optionally exporting user data first.
set -euo pipefail

INSTALL_ROOT=""
EXPORT_PATH=""
KEEP_DATA=0

usage() {
  cat <<'EOF'
Usage: bash scripts/uninstall.sh --install-root DIR [--export PATH] [--keep-data]

Options:
  --install-root DIR   Installed agent directory to remove
  --export PATH        Export archive path (default: sibling timestamped tar.gz)
  --keep-data          Export config/logs/platform skills before removal
  -h, --help           Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-root)
      INSTALL_ROOT="${2:-}"
      shift 2
      ;;
    --export)
      EXPORT_PATH="${2:-}"
      shift 2
      ;;
    --keep-data)
      KEEP_DATA=1
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

if [[ -z "$INSTALL_ROOT" ]]; then
  echo "--install-root is required" >&2
  exit 1
fi

if [[ ! -d "$INSTALL_ROOT" ]]; then
  echo "Install root not found: $INSTALL_ROOT" >&2
  exit 1
fi

if [[ "$KEEP_DATA" -eq 1 ]]; then
  EXPORT_PATH=${EXPORT_PATH:-"$(dirname "$INSTALL_ROOT")/$(basename "$INSTALL_ROOT")-uninstall-export-$(date +%Y%m%d%H%M%S).tar.gz"}
  TMP_EXPORT=$(mktemp -d "${TMPDIR:-/tmp}/nuwax-agent-export-XXXXXX")
  trap 'rm -rf "$TMP_EXPORT"' EXIT

  mkdir -p "$TMP_EXPORT/export"
  for rel in ".env" "logs" "skills/platform" ".nuwax-agent"; do
    if [[ -e "$INSTALL_ROOT/$rel" ]]; then
      mkdir -p "$TMP_EXPORT/export/$(dirname "$rel")"
      cp -R "$INSTALL_ROOT/$rel" "$TMP_EXPORT/export/$rel"
    fi
  done

  if compgen -G "$INSTALL_ROOT/config/*.local.json" > /dev/null; then
    mkdir -p "$TMP_EXPORT/export/config"
    cp "$INSTALL_ROOT"/config/*.local.json "$TMP_EXPORT/export/config"/
  fi

  tar -C "$TMP_EXPORT" -czf "$EXPORT_PATH" export
  echo "Exported user data: $EXPORT_PATH"
fi

rm -rf "$INSTALL_ROOT"
echo "Uninstalled: $INSTALL_ROOT"

