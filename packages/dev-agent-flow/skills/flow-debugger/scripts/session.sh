#!/usr/bin/env bash
# session.sh — dev 调试会话管理（委托 session.py）
#
# 对应平台 agent-dev 调试会话操作：
#   new      新建会话（页面「刷子」按钮）
#   current  获取当前会话
#   cancel   取消/停止会话（页面「停止」按钮）
#
# 用法:
#   ./scripts/session.sh new
#   ./scripts/session.sh current
#   ./scripts/session.sh cancel --conversation <conversationId>
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID, CONVERSATION_ID(cancel 默认)
# 退出码: 0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败 | 4 业务错误

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/session.py" "$@"
