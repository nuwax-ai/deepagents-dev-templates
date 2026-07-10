#!/usr/bin/env bash
# debug.sh — 真实调试目标 Agent（委托给 UTF-8 安全的 debug.py）
#
# 发 prompt 驱动平台真实 agent 执行，收 SSE 结构化结果（文本 + 工具调用 trace + 错误），
# 自动判定通过/失败，聚合定位失败原因。执行挂在用户 agent-dev 预览会话（CONVERSATION_ID）上。
#
# 用法:
#   ./scripts/debug.sh --message "你是谁？"
#   ./scripts/debug.sh --message-file prompts/test.md
#   ./scripts/debug.sh --message "搜索今天的新闻" --expect-tool search --with-logs
#   ./scripts/debug.sh --message "第二轮" --conversation <conversationId>
#   ./scripts/debug.sh --message "测试" --show-trace
#
# Python 检测: ./scripts/check-python.sh
#
# 环境变量: PLATFORM_BASE_URL, SANDBOX_ACCESS_KEY, DEV_AGENT_ID, CONVERSATION_ID(可选, 沙箱注入)
#
# 退出码: 0 通过 | 1 参数错误 | 2 平台未就绪 | 3 HTTP/SSE 失败 | 4 调试不通过

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/debug.py" "$@"
