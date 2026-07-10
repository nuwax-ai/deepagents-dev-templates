#!/usr/bin/env bash
# session.sh — dev 调试会话管理（委托 session.py）
#
# 对应平台 agent-dev 调试会话操作：
#   refresh  拉取当前 devConversationId（GET agent 配置）
#   wait     用户手动点「刷子」后轮询新 devConversationId
#   current  获取 agent 配置全文
#   cancel   取消/停止会话（页面「停止」按钮）
#
# 注意：new 已禁用 —— 「刷子」须用户在预览面板手动点击，脚本不能代建会话。
#
# 用法:
#   ./scripts/session.sh refresh
#   ./scripts/session.sh refresh -q
#   ./scripts/session.sh wait --previous 1555771
#   ./scripts/session.sh current
#   ./scripts/session.sh cancel
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID
# 退出码: 0 成功 | 1 参数错/禁用命令 | 2 平台未就绪 | 3 HTTP 失败/等待超时 | 4 业务错误

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/session.py" "$@"
