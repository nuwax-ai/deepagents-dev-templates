#!/usr/bin/env bash
# approve.sh — HITL 响应：权限审批 / ask-question 回答（委托 approve.py）
#
# 当 debug.sh 遇到人工介入事件（未 --auto-approve）exit 5 时，用本脚本响应：
#   权限审批：  ./scripts/approve.sh --request-id <id> --action approve|reject
#   ask-question：./scripts/approve.sh --request-id <id> --action answer --content "回答"
#                  （长回答用 --content-file <UTF-8 文件>）
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, CONVERSATION_ID(默认会话)
# 退出码: 0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败 | 4 业务错误

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/approve.py" "$@"
