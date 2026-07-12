#!/usr/bin/env bash
# ============================================================
# download-skill.sh — 下载技能到项目目录
# ============================================================
#
# 用法:
#   ./scripts/download-skill.sh [OPTIONS]
#
# Options:
#   --target-id <id>        目标技能 ID（必填，来自 search-skills.sh 结果中的 targetId）
#   --output-dir <dir>      解压输出目录（默认当前目录）
#   --help                  显示此帮助信息
#
# 环境变量（平台注入）:
#   PLATFORM_BASE_URL        平台 API 基础地址（必填）
#   SANDBOX_ACCESS_KEY       沙箱认证密钥（必填）
#   DEV_SPACE_ID             开发空间 ID（必填，用于查询技能信息）
#
# 返回码:
#   0   成功
#   1   参数错误
#   2   环境变量缺失
#   3   查询或下载失败
# ============================================================

set -euo pipefail

# ---- 默认值 ----
TARGET_ID=""
OUTPUT_DIR="."

# ---- 帮助 ----
show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target-id)
            TARGET_ID="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
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
if [[ -z "$TARGET_ID" ]]; then
    echo "[ERROR] --target-id 是必填参数。" >&2
    echo "用法: ./scripts/download-skill.sh --target-id <技能ID>" >&2
    exit 1
fi

if ! [[ "$TARGET_ID" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] --target-id 必须是正整数。" >&2
    exit 1
fi

# ---- 确定 DEV_AGENT_ID（用于 get-config 查询） ----
CONFIG_AGENT_ID="${DEV_AGENT_ID:-}"
if [[ -z "$CONFIG_AGENT_ID" ]]; then
    CONFIG_AGENT_ID="0"  # 若未设置则跳过 get-config 方式
fi

# ---- Step 1: 优先从项目配置中查找技能的 downloadUrl（干净字段） ----
DOWNLOAD_URL=""
SKILL_NAME=""

if [[ "$CONFIG_AGENT_ID" != "0" ]]; then
    echo "[INFO] 正在从项目配置中查询技能 #${TARGET_ID} ..." >&2
    CONFIG_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/${CONFIG_AGENT_ID}"

    CONFIG_RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
        -H "Accept: application/json" \
        --max-time 30 \
        "$CONFIG_URL" 2>&1) || true

    CONFIG_HTTP_CODE=$(echo "$CONFIG_RESPONSE" | tail -n 1)
    CONFIG_BODY=$(echo "$CONFIG_RESPONSE" | sed '$d')

    if [[ "$CONFIG_HTTP_CODE" -eq 200 ]]; then
        RESULT=$(echo "$CONFIG_BODY" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
if resp.get('code') != '0000':
    sys.exit(1)
data = resp.get('data', {})
skills = data.get('skills', [])
target_id = int(sys.argv[1])
for s in skills:
    if s.get('id') == target_id and s.get('downloadUrl'):
        print(s['downloadUrl'])
        print(s.get('name', 'skill'))
        sys.exit(0)
sys.exit(1)
" "$TARGET_ID" 2>/dev/null) && DOWNLOAD_URL=$(echo "$RESULT" | head -1) && SKILL_NAME=$(echo "$RESULT" | tail -1) || true
    fi
fi

# ---- Step 2: 回退到搜索接口（分页遍历，从 schema 文本中提取 URL） ----
if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[INFO] 未在已注册技能中找到，正在搜索技能 #${TARGET_ID} ..." >&2

    SEARCH_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search"

    PAGE=1
    PAGE_SIZE=100
    while [[ "$PAGE" -le 10 ]]; do
        SEARCH_BODY=$(python3 -c "
import json, sys
body = {
    'devSpaceId': int(sys.argv[1]),
    'type': 'skill',
    'page': int(sys.argv[2]),
    'pageSize': int(sys.argv[3])
}
print(json.dumps(body, ensure_ascii=False))
" "$DEV_SPACE_ID" "$PAGE" "$PAGE_SIZE")

        SEARCH_RESPONSE=$(curl -s -w "\n%{http_code}" \
            -X POST \
            -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
            -H "Content-Type: application/json" \
            -H "Accept: application/json" \
            --max-time 30 \
            -d "$SEARCH_BODY" \
            "$SEARCH_URL" 2>&1) || {
            echo "[ERROR] 查询技能信息失败：无法连接到平台。" >&2
            exit 3
        }

        SEARCH_HTTP_CODE=$(echo "$SEARCH_RESPONSE" | tail -n 1)
        SEARCH_RESP_BODY=$(echo "$SEARCH_RESPONSE" | sed '$d')

        if [[ "$SEARCH_HTTP_CODE" -ne 200 ]]; then
            echo "[ERROR] 查询技能返回 HTTP 错误 (${SEARCH_HTTP_CODE})" >&2
            exit 3
        fi

        # 从当前页提取目标技能的下载链接和名称
        RESULT=$(echo "$SEARCH_RESP_BODY" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
if resp.get('code') != '0000':
    sys.exit(1)
data = resp.get('data', [])
target_id = int(sys.argv[1])
found_url = ''
found_name = ''
for item in data:
    if item.get('targetId') == target_id:
        found_name = item.get('name', 'skill')
        for word in item.get('schema', '').split():
            if word.startswith('https://') or word.startswith('http://'):
                found_url = word
                break
        break
# 输出：本页条数\\n下载链接\\n名称
print(len(data))
print(found_url)
print(found_name)
" "$TARGET_ID" 2>/dev/null) || {
            echo "[ERROR] 解析搜索结果失败。" >&2
            exit 3
        }

        PAGE_COUNT=$(echo "$RESULT" | sed -n '1p')
        PAGE_URL=$(echo "$RESULT" | sed -n '2p')
        PAGE_NAME=$(echo "$RESULT" | sed -n '3p')

        if [[ -n "$PAGE_URL" ]]; then
            DOWNLOAD_URL="$PAGE_URL"
            [[ -z "$SKILL_NAME" ]] && SKILL_NAME="$PAGE_NAME"
            break
        fi

        # 本页不足一页，说明已到末尾
        if [[ "$PAGE_COUNT" -lt "$PAGE_SIZE" ]]; then
            break
        fi
        PAGE=$((PAGE + 1))
    done
fi

if [[ -z "$DOWNLOAD_URL" ]]; then
    echo "[ERROR] 未找到技能 #${TARGET_ID} 或其下载链接。" >&2
    echo "请确认 targetId 是否正确（使用 search-skills.sh 查询）。" >&2
    exit 3
fi

echo "[INFO] 下载地址: ${DOWNLOAD_URL}" >&2

# ---- Step 3: 下载 zip 文件 ----

TMP_ZIP="/tmp/skill_${TARGET_ID}_${SKILL_NAME}.zip"

echo "[INFO] 正在下载 ${SKILL_NAME} ..." >&2

HTTP_CODE=$(curl -s -w "%{http_code}" \
    -o "$TMP_ZIP" \
    --max-time 120 \
    "$DOWNLOAD_URL" 2>&1)

if [[ "$HTTP_CODE" -ne 200 ]]; then
    echo "[ERROR] 下载失败 (HTTP ${HTTP_CODE})" >&2
    rm -f "$TMP_ZIP"
    exit 3
fi

echo "[INFO] 下载完成 ($(du -h "$TMP_ZIP" | cut -f1))" >&2

# ---- Step 4: 解压到输出目录 ----
mkdir -p "$OUTPUT_DIR"

echo "[INFO] 正在解压到 ${OUTPUT_DIR} ..." >&2

if ! unzip -o -q "$TMP_ZIP" -d "$OUTPUT_DIR" 2>&1; then
    echo "[ERROR] 解压失败。" >&2
    rm -f "$TMP_ZIP"
    exit 3
fi

# ---- 清理 ----
rm -f "$TMP_ZIP"

echo "[OK] 技能「${SKILL_NAME}」已下载并解压到 ${OUTPUT_DIR}" >&2

# ---- 列出解压结果 ----
echo ""
echo "文件列表:"
find "$OUTPUT_DIR" -maxdepth 3 -not -type d | head -30 | while read -r f; do
    echo "  ${f}"
done
