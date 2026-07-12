#!/usr/bin/env bash
# get-config.sh — 获取智能体项目配置（委托给 UTF-8 安全的 get-config.py）
#
# 用法:
#   ./scripts/get-config.sh
#   ./scripts/get-config.sh --key systemPrompt
#   ./scripts/get-config.sh --key tools --full   # 取完整工具配置（含真实工具名与 schema）
#
# Python 检测: ./scripts/check-python.sh
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/get-config.py" "$@"
