#!/usr/bin/env bash
# search-apis.sh — 搜索平台可用工具/API 接口（委托给 UTF-8 安全的 search-tools.py）
#
# 用法:
#   ./scripts/search-apis.sh [OPTIONS]
#
# Options:
#   --kw <keyword>          搜索关键词（模糊匹配）
#   --kw-file <path>        从 UTF-8 文件读取关键词（中文推荐）
#   --page <n>              页码（默认 1）
#   --page-size <n>         每页数量（默认 20）
#   --format json|table     输出格式（默认 json）
#   --help                  显示此帮助信息
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_SPACE_ID
#
# Python 检测: ./scripts/check-python.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

if [[ "${1:-}" == "--help" ]]; then
    show_help
fi

python_exec_script "$SCRIPT_DIR/search-tools.py" --type tool "$@"
