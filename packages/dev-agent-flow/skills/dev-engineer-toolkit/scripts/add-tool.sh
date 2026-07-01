#!/usr/bin/env bash
# ============================================================
# add-tool.sh — 向智能体项目注册/添加工具
# ============================================================
#
# 用法:
#   ./scripts/add-tool.sh [OPTIONS]
#
# Options:
#   --target-type <type>    目标类型（必填）：Plugin, Workflow, Knowledge, Skill
#   --target-id <id>        目标对象 ID（必填，来自 search-apis.sh 结果中的 targetId）
#   --help                  显示此帮助信息
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
TARGET_TYPE=""
TARGET_ID=""

# ---- 帮助 ----
show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-type)
            TARGET_TYPE="$2"
            shift 2
            ;;
        --target-id)
            TARGET_ID="$2"
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

# ---- 平台运行时检查 ----
if [[ -z "${PLATFORM_BASE_URL:-}" || -z "${SANDBOX_ACCESS_KEY:-}" || -z "${DEV_AGENT_ID:-}" ]]; then
    echo "[ERROR] 平台运行时未就绪，请确认在沙箱环境中执行。" >&2
    exit 2
fi

# ---- 参数校验 ----
if [[ -z "$TARGET_TYPE" ]]; then
    echo "[ERROR] --target-type 是必填参数。" >&2
    echo "可选值: Plugin, Workflow, Knowledge, Skill" >&2
    exit 1
fi

VALID_TYPES=("Plugin" "Workflow" "Knowledge" "Skill")
TYPE_VALID=0
for t in "${VALID_TYPES[@]}"; do
    if [[ "$TARGET_TYPE" == "$t" ]]; then
        TYPE_VALID=1
        break
    fi
done
if [[ "$TYPE_VALID" -eq 0 ]]; then
    echo "[ERROR] --target-type 无效: $TARGET_TYPE" >&2
    echo "可选值: ${VALID_TYPES[*]}" >&2
    exit 1
fi

if [[ -z "$TARGET_ID" ]]; then
    echo "[ERROR] --target-id 是必填参数。" >&2
    exit 1
fi

if ! [[ "$TARGET_ID" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] --target-id 必须是正整数。" >&2
    exit 1
fi

if ! [[ "$DEV_AGENT_ID" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] 项目标识无效。" >&2
    exit 1
fi

# ---- 构建请求体 ----
REQUEST_BODY=$(python3 -c "
import json, sys
body = {
    'devAgentId': int(sys.argv[1]),
    'targetType': sys.argv[2],
    'targetId': int(sys.argv[3])
}
print(json.dumps(body, ensure_ascii=False))
" "$DEV_AGENT_ID" "$TARGET_TYPE" "$TARGET_ID")

# ---- API 调用 ----
API_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/add"

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

if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "[ERROR] API 返回 HTTP 错误 (${HTTP_CODE}):" >&2
    echo "$BODY" >&2
    exit 3
fi

# ---- 检查业务状态码 ----
BIZ_CODE=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")
BIZ_MSG=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")

if [[ "$BIZ_CODE" != "0000" ]]; then
    echo "[ERROR] 注册失败 (code=${BIZ_CODE}): ${BIZ_MSG}" >&2
    echo "$BODY" >&2
    exit 4
fi

# ---- 输出 ----
echo "[OK] 工具注册成功"
echo "  Agent ID : ${DEV_AGENT_ID}"
echo "  类型     : ${TARGET_TYPE}"
echo "  目标 ID  : ${TARGET_ID}"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
