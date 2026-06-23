#!/usr/bin/env bash
# ============================================================
# get-config.sh — 获取当前智能体项目的配置信息
# ============================================================
#
# 用法:
#   ./scripts/get-config.sh [OPTIONS]
#
# Options:
#   --key <section>         只查看指定配置项：systemPrompt, openingChatMsg, tools, skills, mcpConfigs
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
KEY=""

# ---- 帮助 ----
show_help() {
    awk 'NR>1 { if (/^[^#]/ && !/^$/) exit; sub(/^# ?/,""); print }' "$0"
    exit 0
}

# ---- 参数解析 ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --key)
            KEY="$2"
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

# ---- 参数校验 ----
VALID_KEYS=("systemPrompt" "openingChatMsg" "tools" "skills" "mcpConfigs")
if [[ -n "$KEY" ]]; then
    KEY_VALID=0
    for k in "${VALID_KEYS[@]}"; do
        if [[ "$KEY" == "$k" ]]; then
            KEY_VALID=1
            break
        fi
    done
    if [[ "$KEY_VALID" -eq 0 ]]; then
        echo "[ERROR] --key 无效: $KEY" >&2
        echo "可选值: ${VALID_KEYS[*]}" >&2
        exit 1
    fi
fi

# ---- API 调用 ----
API_URL="${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/${DEV_AGENT_ID}"

RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
    -H "Accept: application/json" \
    --max-time 30 \
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
    echo "[ERROR] 业务错误 (code=${BIZ_CODE}): ${BIZ_MSG}" >&2
    echo "$BODY" >&2
    exit 4
fi

# ---- 输出 ----
if [[ -n "$KEY" ]]; then
    echo "$BODY" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
data = resp.get('data', {})
key = sys.argv[1]
if key in data:
    val = data[key]
    if isinstance(val, list):
        if key == 'tools':
            print(f'=== 已注册工具 ({len(val)} 个) ===')
            for item in val:
                print(f'  [{item.get(\"targetType\",\"\")}] #{item.get(\"targetId\",\"\")} {item.get(\"name\",\"\")}')
        elif key == 'skills':
            print(f'=== 已注册技能 ({len(val)} 个) ===')
            for item in val:
                print(f'  #{item.get(\"id\",\"\")} {item.get(\"name\",\"\")}')
                if item.get('downloadUrl'):
                    print(f'    下载: {item[\"downloadUrl\"]}')
        elif key == 'mcpConfigs':
            print(f'=== MCP 配置 ({len(val)} 个) ===')
            for item in val:
                print(f'  {item.get(\"name\",\"\")} - {item.get(\"description\",\"\") or \"\"}')
        else:
            print(json.dumps(val, ensure_ascii=False, indent=2))
    elif isinstance(val, str):
        print(val)
    else:
        print(json.dumps(val, ensure_ascii=False, indent=2))
" "$KEY"
else
    # 输出全部配置
    echo "$BODY" | python3 -c "
import json, sys
resp = json.load(sys.stdin)
data = resp.get('data', {})

sp = data.get('systemPrompt', '')
ocm = data.get('openingChatMsg', '')
tools = data.get('tools', [])
skills = data.get('skills', [])
mcps = data.get('mcpConfigs', [])

print('========================================')
print('  智能体 #${DEV_AGENT_ID} 配置信息')
print('========================================')
print()
print('--- 系统提示词 ---')
print(sp if sp else '(未设置)')
print()
print('--- 开场白 ---')
print(ocm if ocm else '(未设置)')
print()
print(f'--- 已注册工具 ({len(tools)} 个) ---')
for item in tools:
    print(f'  [{item.get(\"targetType\",\"\")}] #{item.get(\"targetId\",\"\")} {item.get(\"name\",\"\")}')
print()
print(f'--- 已注册技能 ({len(skills)} 个) ---')
for item in skills:
    print(f'  #{item.get(\"id\",\"\")} {item.get(\"name\",\"\")}')
    if item.get('downloadUrl'):
        print(f'    下载: {item[\"downloadUrl\"]}')
print()
print(f'--- MCP 配置 ({len(mcps)} 个) ---')
for item in mcps:
    print(f'  {item.get(\"name\",\"\")} - {item.get(\"description\",\"\") or \"?\"}')
"
fi
