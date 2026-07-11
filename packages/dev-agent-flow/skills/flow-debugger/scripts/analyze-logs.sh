#!/usr/bin/env bash
# analyze-logs.sh — 分析 .logs/ 运行日志（委托 analyze-logs.py）
#
# 真实调试的 runtime 视角诊断：读 .logs/ 提取错误/工具调用/flow状态/permission/模型问题。
# 与 debug.sh（平台视角 SSE 结果）组成完整调试闭环：debug.sh 看平台返回，analyze-logs 看 runtime 内部。
# 收工必经：成功与否须日志佐证；推荐 debug.sh --with-logs 一步完成双证。
#
# 用法:
#   ./scripts/analyze-logs.sh                          # 分析最新日志
#   ./scripts/analyze-logs.sh --session <sessionId>    # 按会话过滤
#   ./scripts/analyze-logs.sh --file <日志文件>         # 指定文件
#   ./scripts/analyze-logs.sh --since 10               # 最近 10 分钟
#   ./scripts/analyze-logs.sh --dir <日志目录>          # 指定目录
#
# 环境变量: LOG_DIR(日志目录；未设时按 <cwd>/.logs > <项目根>/.logs(向上找) > ~/.flowagents/logs 依次查找)
# 退出码: 0 正常(未发现问题) | 1 参数错 | 3 找不到日志 | 4 发现问题

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

python_exec_script "$SCRIPT_DIR/analyze-logs.py" "$@"
