#!/usr/bin/env bash
# agent_tool.sh — Agent 工具配置管理 CLI 封装
#
# 封装 4sandbox/agent/dev/* 全部端点，提供统一的命令行入口：
#   config         获取 Agent 配置（JSON）
#   update-prompt  更新系统提示词   --text "..."
#   update-opening 更新开场白       --text "..."
#   search         搜索可用工具     --kw "关键词" [--dev-space-id N] [--page N] [--page-size N]
#   add-tool       添加工具         --type Plugin|Workflow|Knowledge --id N
#   del-tool       删除工具         --type Plugin|Workflow|Knowledge --id N
#
# 依赖环境变量：
#   PLATFORM_BASE_URL  平台地址，例如 https://testagent.xspaceagi.com
#   SANDBOX_ACCESS_KEY Bearer 鉴权令牌
#   DEV_AGENT_ID       开发的 Agent ID（config/update/add/del 必填）
#   DEV_SPACE_ID       （仅 search 必填）dev 空间 ID
#
# 用法示例：
#   ./agent_tool.sh config
#   ./agent_tool.sh search --kw "搜索"
#   ./agent_tool.sh add-tool --type Plugin --id 611
#   ./agent_tool.sh del-tool --type Plugin --id 611
#
# 说明：本脚本只做请求与回显，不做隐式修改；任何写操作后请自行调用 config 验证。

set -euo pipefail

BASE="${PLATFORM_BASE_URL:-}"
TOKEN="${SANDBOX_ACCESS_KEY:-}"
AGENT_ID="${DEV_AGENT_ID:-}"
API="${BASE}/api/v1/4sandbox/agent/dev"

die() { echo "ERROR: $*" >&2; exit 1; }

require_env() {
  [ -n "$BASE" ]    || die "缺少环境变量 PLATFORM_BASE_URL"
  [ -n "$TOKEN" ]   || die "缺少环境变量 SANDBOX_ACCESS_KEY"
}

require_agent() {
  require_env
  [ -n "$AGENT_ID" ] || die "缺少环境变量 DEV_AGENT_ID"
}

post() {
  local path="$1"; local body="${2:-}"
  if [ -n "$body" ]; then
    curl -fsS -X POST "${API}${path}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d "$body"
  else
    curl -fsS -X POST "${API}${path}" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${TOKEN}"
  fi
}

json_escape() {
  # 将文本转义为可安全嵌入 JSON 字符串字面量的形式
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

valid_type() {
  case "$1" in
    Plugin|Workflow|Knowledge) return 0 ;;
    *) die "非法 --type：$1（应为 Plugin / Workflow / Knowledge）" ;;
  esac
}

usage() {
  sed -n '2,28p' "$0"
}

[ $# -ge 1 ] || { usage; exit 1; }
cmd="$1"; shift || true

case "$cmd" in
  config)
    require_agent
    curl -fsS -X GET "${API}/config/${AGENT_ID}" -H "Authorization: Bearer ${TOKEN}"
    echo
    ;;

  update-prompt)
    text=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --text) text="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    [ -n "$text" ] || die "需要 --text \"...\""
    require_agent
    body="{\"devAgentId\":${AGENT_ID},\"systemPrompt\":$(json_escape "$text")}"
    post "/config/update" "$body"; echo
    ;;

  update-opening)
    text=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --text) text="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    [ -n "$text" ] || die "需要 --text \"...\""
    require_agent
    body="{\"devAgentId\":${AGENT_ID},\"openingChatMsg\":$(json_escape "$text")}"
    post "/config/update" "$body"; echo
    ;;

  search)
    kw=""; dev_space="${DEV_SPACE_ID:-}"; page=""; page_size=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --kw) kw="$2"; shift 2 ;;
        --dev-space-id) dev_space="$2"; shift 2 ;;
        --page) page="$2"; shift 2 ;;
        --page-size) page_size="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    require_env
    [ -n "$dev_space" ] || die "需要 --dev-space-id 或环境变量 DEV_SPACE_ID"
    # 逐字段拼装，跳过空值字段
    body=$(python3 - "$dev_space" "$kw" "$page" "$page_size" <<'PY'
import json, sys
dev_space, kw, page, page_size = sys.argv[1:5]
d = {"devSpaceId": int(dev_space)}
if kw:        d["kw"] = kw
if page:      d["page"] = int(page)
if page_size: d["pageSize"] = int(page_size)
print(json.dumps(d))
PY
)
    post "/tool/search" "$body"; echo
    ;;

  add-tool)
    ttype=""; tid=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --type) ttype="$2"; shift 2 ;;
        --id)   tid="$2";   shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    [ -n "$ttype" ] || die "需要 --type"
    [ -n "$tid" ]   || die "需要 --id"
    valid_type "$ttype"
    require_agent
    body="{\"devAgentId\":${AGENT_ID},\"targetType\":\"${ttype}\",\"targetId\":${tid}}"
    post "/config/tool/add" "$body"; echo
    ;;

  del-tool)
    ttype=""; tid=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --type) ttype="$2"; shift 2 ;;
        --id)   tid="$2";   shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    [ -n "$ttype" ] || die "需要 --type"
    [ -n "$tid" ]   || die "需要 --id"
    valid_type "$ttype"
    require_agent
    body="{\"devAgentId\":${AGENT_ID},\"targetType\":\"${ttype}\",\"targetId\":${tid}}"
    post "/config/tool/delete" "$body"; echo
    ;;

  -h|--help|help) usage; exit 0 ;;
  *) die "未知命令：$cmd（config / update-prompt / update-opening / search / add-tool / del-tool）" ;;
esac
