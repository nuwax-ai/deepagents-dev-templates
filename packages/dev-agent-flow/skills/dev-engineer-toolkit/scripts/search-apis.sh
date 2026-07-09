#!/usr/bin/env bash
# ============================================================
# search-apis.sh — 搜索平台可用工具/API 接口
# ============================================================
#
# 用法:
#   ./scripts/search-apis.sh [OPTIONS]
#
# Options:
#   --kw <keyword>          搜索关键词（模糊匹配）
#   --page <n>              页码（默认 1）
#   --page-size <n>         每页数量（默认 20）
#   --format json|table     输出格式（默认 json）
#   --help                  显示此帮助信息
#
# 环境变量（平台注入）:
#   PLATFORM_BASE_URL        平台 API 基础地址（必填）
#   SANDBOX_ACCESS_KEY               认证 Token（必填）
#   DEV_SPACE_ID             开发空间 ID（必填）
#
# 返回码:
#   0   成功
#   1   参数错误
#   2   环境变量缺失
#   3   API 调用失败
#   4   业务错误（API 返回非成功状态码）
# ============================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ensure-python.sh
source "$SCRIPT_DIR/lib/ensure-python.sh"

# ---- 默认值 ----
KW=""
PAGE=1
PAGE_SIZE=20
FORMAT="json"

# ---- 帮助 ----
show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --kw)
            KW="$2"
            shift 2
            ;;
        --page)
            PAGE="$2"
            shift 2
            ;;
        --page-size)
            PAGE_SIZE="$2"
            shift 2
            ;;
        --format)
            FORMAT="$2"
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
if [[ -z "${PLATFORM_BASE_URL:-}" || -z "${SANDBOX_ACCESS_KEY:-}" || -z "${DEV_SPACE_ID:-}" ]]; then
    echo "[ERROR] 平台运行时未就绪，请确认在沙箱环境中执行。" >&2
    exit 2
fi

# ---- 参数校验 ----
if ! [[ "$PAGE" =~ ^[0-9]+$ ]] || [[ "$PAGE" -lt 1 ]]; then
    echo "[ERROR] --page 必须是正整数。" >&2
    exit 1
fi

if ! [[ "$PAGE_SIZE" =~ ^[0-9]+$ ]] || [[ "$PAGE_SIZE" -lt 1 ]] || [[ "$PAGE_SIZE" -gt 100 ]]; then
    echo "[ERROR] --page-size 必须是 1-100 之间的整数。" >&2
    exit 1
fi

if [[ "$FORMAT" != "json" && "$FORMAT" != "table" ]]; then
    echo "[ERROR] --format 必须是 json 或 table。" >&2
    exit 1
fi

# ---- 构建请求体 ----
REQUEST_BODY=$(python_run -c "
import json, sys
body = {
    'devSpaceId': int(sys.argv[1]),
    'type': 'tool'
}
kw = sys.argv[2]
page = int(sys.argv[3])
page_size = int(sys.argv[4])
if kw:
    body['kw'] = kw
if page > 1:
    body['page'] = page
if page_size != 20:
    body['pageSize'] = page_size
print(json.dumps(body, ensure_ascii=False))
" "$DEV_SPACE_ID" "$KW" "$PAGE" "$PAGE_SIZE")

# ---- API 调用 ----
API_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search"

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
BIZ_CODE=$(echo "$BODY" | python_run -c "import json,sys; print(json.load(sys.stdin).get('code',''))" 2>/dev/null || echo "")
BIZ_SUCCESS=$(echo "$BODY" | python_run -c "import json,sys; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")

if [[ "$BIZ_CODE" != "0000" ]]; then
    BIZ_MSG=$(echo "$BODY" | python_run -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null || echo "")
    echo "[ERROR] 业务错误 (code=${BIZ_CODE}): ${BIZ_MSG}" >&2
    echo "$BODY" >&2
    exit 4
fi

# ---- 输出 ----
if [[ "$FORMAT" == "table" ]]; then
    echo "$BODY" | python_run -c "
import json, sys
resp = json.load(sys.stdin)
data = resp.get('data', [])
print(f'共 {len(data)} 条结果')
print('-' * 90)
print(f'{\"ID\":<12} {\"类型\":<14} {\"名称\":<24} 描述')
print('-' * 90)
for item in data:
    tid = str(item.get('targetId', ''))[:10]
    ttype = item.get('targetType', '')[:12]
    name = item.get('name', '')[:22]
    desc = (item.get('description', '') or '')[:34]
    print(f'{tid:<12} {ttype:<14} {name:<24} {desc}')
" 2>/dev/null || echo "$BODY"
else
    echo "$BODY"
fi
