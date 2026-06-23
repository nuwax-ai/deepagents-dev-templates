#!/usr/bin/env bash
# ============================================================
# update-config.sh — 更新智能体项目的配置信息
# ============================================================
#
# 用法:
#   ./scripts/update-config.sh [OPTIONS]
#
# Options:
#   --system-prompt <text>  新的系统提示词
#   --system-prompt-file <path>  从文件读取系统提示词
#   --opening-msg <text>    新的开场白
#   --opening-msg-file <path>   从文件读取开场白
#   --help                  显示此帮助信息
#
# 至少指定 --system-prompt 或 --opening-msg 之一（含 file 版本）。
# 留空的字段不会被修改。
#
# 环境变量（平台注入，脚本内部自动读取）:
#   PLATFORM_BASE_URL        平台 API 基础地址（必填）
#   SANDBOX_ACCESS_KEY       沙箱认证密钥（必填）
#   DEV_AGENT_ID             开发的 Agent ID（必填）
#
# 返回码:
#   0   成功
#   1   参数错误
#   2   环境变量缺失
#   3   API 调用失败
#   4   业务错误（API 返回非成功状态码）
# ============================================================

set -euo pipefail

# ---- 默认值 ----
SYSTEM_PROMPT=""
SYSTEM_PROMPT_FILE=""
OPENING_MSG=""
OPENING_MSG_FILE=""

# ---- 帮助 ----
show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --system-prompt)
            SYSTEM_PROMPT="$2"
            shift 2
            ;;
        --system-prompt-file)
            SYSTEM_PROMPT_FILE="$2"
            shift 2
            ;;
        --opening-msg)
            OPENING_MSG="$2"
            shift 2
            ;;
        --opening-msg-file)
            OPENING_MSG_FILE="$2"
            shift 2
            ;;
        --help)
            show_help
            ;;
        *)
            echo "[ERROR] 未知参数: $1" >&2
            echo "使用 --help 查看帮助。" >&2
            exit 1
            ;;
    esac
done

# ---- 环境变量检查 ----
for v in PLATFORM_BASE_URL SANDBOX_ACCESS_KEY DEV_AGENT_ID; do
    if [[ -z "${!v:-}" ]]; then echo "[ERROR] 环境变量 ${v} 未设置。" >&2; exit 2; fi
done

if ! [[ "${DEV_AGENT_ID:-}" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] 环境变量 DEV_AGENT_ID 必须是正整数。" >&2
    exit 1
fi

# ---- 至少指定一个要更新的字段 ----
HAS_UPDATE=0

if [[ -n "$SYSTEM_PROMPT" || -n "$SYSTEM_PROMPT_FILE" ]]; then HAS_UPDATE=1; fi
if [[ -n "$OPENING_MSG" || -n "$OPENING_MSG_FILE" ]]; then HAS_UPDATE=1; fi

if [[ "$HAS_UPDATE" -eq 0 ]]; then
    echo "[ERROR] 至少需要指定一个要更新的字段。" >&2
    echo "  --system-prompt <text>  或  --system-prompt-file <path>" >&2
    echo "  --opening-msg <text>    或  --opening-msg-file <path>" >&2
    exit 1
fi

# ---- 解析文件内容 ----
if [[ -n "$SYSTEM_PROMPT_FILE" ]]; then
    if [[ ! -f "$SYSTEM_PROMPT_FILE" ]]; then
        echo "[ERROR] 文件不存在: $SYSTEM_PROMPT_FILE" >&2
        exit 1
    fi
    SYSTEM_PROMPT=$(cat "$SYSTEM_PROMPT_FILE")
    echo "[INFO] 从文件读取 systemPrompt: $SYSTEM_PROMPT_FILE (${#SYSTEM_PROMPT} 字符)" >&2
fi

if [[ -n "$OPENING_MSG_FILE" ]]; then
    if [[ ! -f "$OPENING_MSG_FILE" ]]; then
        echo "[ERROR] 文件不存在: $OPENING_MSG_FILE" >&2
        exit 1
    fi
    OPENING_MSG=$(cat "$OPENING_MSG_FILE")
    echo "[INFO] 从文件读取 openingChatMsg: $OPENING_MSG_FILE (${#OPENING_MSG} 字符)" >&2
fi

# ---- 构建请求体（只包含非空字段） ----
REQUEST_BODY=$(python3 -c "
import json, sys
body = {'devAgentId': int(sys.argv[1])}
sp = sys.argv[2]
ocm = sys.argv[3]
if sp:
    body['systemPrompt'] = sp
if ocm:
    body['openingChatMsg'] = ocm
print(json.dumps(body, ensure_ascii=False))
" "$DEV_AGENT_ID" "$SYSTEM_PROMPT" "$OPENING_MSG")

# ---- API 调用 ----
API_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/update"

RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    --max-time 30 \
    -d "$REQUEST_BODY" \
    "$API_URL" 2>&1) || {
    echo "[ERROR] API 请求失败：无法连接到平台。" >&2
    exit 3
}

# ---- 解析响应 ----
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" -eq 404 ]]; then
    echo "[ERROR] Agent 不存在: ${DEV_AGENT_ID}" >&2
    exit 3
fi

if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "[ERROR] API 返回 HTTP 错误 (${HTTP_CODE}):" >&2
    echo "$BODY" >&2
    exit 3
fi

# ---- 检查业务状态码 ----
BIZ_CODE=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")
BIZ_MSG=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")

if [[ "$BIZ_CODE" != "0000" ]]; then
    echo "[ERROR] 更新失败 (code=${BIZ_CODE}): ${BIZ_MSG}" >&2
    exit 4
fi

# ---- 输出 ----
echo "[OK] 配置更新成功"
if [[ -n "$SYSTEM_PROMPT" ]]; then
    echo "  已更新 systemPrompt (${#SYSTEM_PROMPT} 字符)"
fi
if [[ -n "$OPENING_MSG" ]]; then
    echo "  已更新 openingChatMsg (${#OPENING_MSG} 字符)"
fi
