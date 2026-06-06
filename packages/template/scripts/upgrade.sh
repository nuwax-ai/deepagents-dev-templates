#!/usr/bin/env bash
# Upgrade an installed Nuwax agent artifact with rollback support.
set -euo pipefail

ARTIFACT=""
INSTALL_ROOT=""
ROLLBACK=0

usage() {
  cat <<'EOF'
Usage:
  bash scripts/upgrade.sh --artifact PATH --install-root DIR
  bash scripts/upgrade.sh --rollback --install-root DIR

Options:
  --artifact PATH      New npm tgz, Nuwax tar.gz, or Nuwax zip artifact
  --install-root DIR   Existing install directory
  --rollback           Restore the last backup recorded by upgrade
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
    --rollback)
      ROLLBACK=1
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

STATE_FILE="$INSTALL_ROOT/.nuwax-agent/upgrade-state.json"

rollback() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "No upgrade state found: $STATE_FILE" >&2
    exit 1
  fi

  local backup
  backup=$(node -p "require('$STATE_FILE').backupPath")
  if [[ ! -d "$backup" ]]; then
    echo "Backup path does not exist: $backup" >&2
    exit 1
  fi

  local failed="${INSTALL_ROOT}.failed-$(date +%Y%m%d%H%M%S)"
  mv "$INSTALL_ROOT" "$failed"
  cp -R "$backup" "$INSTALL_ROOT"
  echo "Rollback complete: $INSTALL_ROOT"
  echo "Previous failed install moved to: $failed"
}

if [[ "$ROLLBACK" -eq 1 ]]; then
  rollback
  exit 0
fi

if [[ -z "$ARTIFACT" ]]; then
  echo "--artifact is required unless --rollback is used" >&2
  exit 1
fi

if [[ ! -d "$INSTALL_ROOT" ]]; then
  echo "Install root not found: $INSTALL_ROOT" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACT" ]]; then
  echo "Artifact not found: $ARTIFACT" >&2
  exit 1
fi

BACKUP_ROOT="$(dirname "$INSTALL_ROOT")/.nuwax-agent-backups"
BACKUP_PATH="$BACKUP_ROOT/$(basename "$INSTALL_ROOT")-$(date +%Y%m%d%H%M%S)"
TMP_INSTALL="${INSTALL_ROOT}.next-$(date +%Y%m%d%H%M%S)"

mkdir -p "$BACKUP_ROOT"
cp -R "$INSTALL_ROOT" "$BACKUP_PATH"

bash "$(dirname "$0")/install.sh" --artifact "$ARTIFACT" --install-root "$TMP_INSTALL" --force

preserve_path() {
  local rel="$1"
  if [[ -e "$BACKUP_PATH/$rel" ]]; then
    rm -rf "$TMP_INSTALL/$rel"
    mkdir -p "$(dirname "$TMP_INSTALL/$rel")"
    cp -R "$BACKUP_PATH/$rel" "$TMP_INSTALL/$rel"
  fi
}

preserve_path ".env"
preserve_path "logs"
preserve_path "skills/platform"

if compgen -G "$BACKUP_PATH/config/*.local.json" > /dev/null; then
  mkdir -p "$TMP_INSTALL/config"
  cp "$BACKUP_PATH"/config/*.local.json "$TMP_INSTALL/config"/
fi

mkdir -p "$TMP_INSTALL/.nuwax-agent"
BACKUP_PATH="$BACKUP_PATH" ARTIFACT="$ARTIFACT" TMP_INSTALL="$TMP_INSTALL" node <<'NODE'
const fs = require("fs");
const path = require("path");

const pkg = JSON.parse(fs.readFileSync(path.join(process.env.TMP_INSTALL, "package.json"), "utf8"));
const state = {
  schema: "nuwax.agent.upgrade-state.v1",
  packageName: pkg.name,
  version: pkg.version,
  artifact: path.basename(process.env.ARTIFACT),
  backupPath: process.env.BACKUP_PATH,
  upgradedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(process.env.TMP_INSTALL, ".nuwax-agent", "upgrade-state.json"), JSON.stringify(state, null, 2) + "\n");
NODE

OLD_PATH="${INSTALL_ROOT}.previous-$(date +%Y%m%d%H%M%S)"
mv "$INSTALL_ROOT" "$OLD_PATH"
mv "$TMP_INSTALL" "$INSTALL_ROOT"

echo "Upgrade complete: $INSTALL_ROOT"
echo "Backup: $BACKUP_PATH"
echo "Previous install moved to: $OLD_PATH"

