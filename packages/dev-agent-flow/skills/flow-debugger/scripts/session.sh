#!/usr/bin/env bash
# session.sh — dev 调试会话管理（委托 session.py）
#
# 对应平台 agent-dev 调试会话操作：
#   new      新建调试会话（POST /conversation/create，与 UI「刷子」等价）
#   refresh  拉取当前 devConversationId（GET agent 配置）
#   wait     用户手动点「刷子」后轮询新 devConversationId
#   current  获取 agent 配置全文
#   cancel   取消/停止会话（页面「停止」按钮）
#
# 用法:
#   ./scripts/session.sh new                  # 直接新建调试会话（推荐，改动 flow 代码后干净验证）
#   ./scripts/session.sh new -q               # 仅输出新会话 ID
#   ./scripts/session.sh refresh
#   ./scripts/session.sh refresh -q
#   ./scripts/session.sh wait --previous 1555771
#   ./scripts/session.sh current
#   ./scripts/session.sh cancel
#   # cancel 后继续同会话请先 ./scripts/debug.sh --wait-idle；干净验证优先 new/new-session
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID
# 退出码: 0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败/等待超时 | 4 业务错误

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/session.py" "$@"
