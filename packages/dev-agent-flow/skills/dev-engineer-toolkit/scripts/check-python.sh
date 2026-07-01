#!/usr/bin/env bash
# check-python.sh — 检测 Python / uv 是否可用；可选通过 uv 自动安装
#
# 用法:
#   ./scripts/check-python.sh           # 仅检测并报告
#   ./scripts/check-python.sh --install # 缺失时用 uv python install 补齐
#
# 返回码: 0 有可用 Python | 1 不可用且未安装 | 2 uv 安装失败

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL=1
      shift
      ;;
    --help|-h)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[ERROR] 未知参数: $1" >&2
      exit 1
      ;;
  esac
done

if python_report_status; then
  exit 0
fi

if [[ "$INSTALL" -eq 0 ]]; then
  exit 1
fi

if python_install_via_uv; then
  echo
  python_report_status
  exit 0
fi

echo "[ERROR] uv 自动安装 Python 失败。" >&2
exit 2
