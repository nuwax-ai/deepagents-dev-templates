#!/usr/bin/env bash
# update-config.sh — 更新智能体项目配置（委托给 UTF-8 安全的 update-config.py）
#
# 用法:
#   ./scripts/update-config.sh --system-prompt-file prompts/flow.base.md
#
# 含中文的长文本请优先使用 --system-prompt-file（UTF-8 文件）。
# Python 检测: ./scripts/check-python.sh ；缺失时 ./scripts/check-python.sh --install
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID
# 返回码: 0 成功 | 1 参数 | 2 环境变量/Python | 3 HTTP | 4 业务错误

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/update-config.py" "$@"
