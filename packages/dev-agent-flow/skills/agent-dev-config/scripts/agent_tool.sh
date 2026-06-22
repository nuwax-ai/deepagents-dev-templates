#!/usr/bin/env bash
# agent_tool.sh — Agent 工具配置管理 CLI 封装
#
# 封装 4sandbox/agent/dev/* 全部端点，提供统一的命令行入口：
#   config         获取 Agent 配置（JSON）
#   update-prompt  更新系统提示词   --text "..." | --file <path>（- 表示 stdin）
#   update-opening 更新开场白       --text "..." | --file <path>（- 表示 stdin）
#   search         搜索可用工具     --kw "关键词" [--dev-space-id N] [--page N] [--page-size N]
#   add-tool       添加工具         --type Plugin|Workflow|Knowledge --id N
#   del-tool       删除工具         --type Plugin|Workflow|Knowledge --id N
#
# 依赖：curl + 环境变量（见下）。
# update-prompt / update-opening / search 另需可用的 python3 或 python（拼 JSON）。
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

# 仅 update-prompt / update-opening / search 需要 Python 拼 JSON
PYTHON=""
resolve_python() {
  if [ -n "$PYTHON" ]; then
    return 0
  fi
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys' >/dev/null 2>&1; then
      PYTHON="$candidate"
      return 0
    fi
  done
  die "需要可用的 python3 或 python（用于拼 JSON）"
}

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
      -H "Content-Type: application/json; charset=utf-8" \
      -H "Authorization: Bearer ${TOKEN}" \
      -d "$body"
  else
    curl -fsS -X POST "${API}${path}" \
      -H "Content-Type: application/json; charset=utf-8" \
      -H "Authorization: Bearer ${TOKEN}"
  fi
}

build_update_body() {
  # 经 Python 拼 JSON，避免长文本经 shell 变量 / argv 传递触发 ARG_MAX
  resolve_python
  local field="$1" text="$2" file="$3"
  if [ -n "$text" ] && [ -n "$file" ]; then
    die "--text 与 --file 不能同时使用"
  fi
  if [ -z "$text" ] && [ -z "$file" ]; then
    die "需要 --text \"...\" 或 --file <path>（- 表示 stdin）"
  fi
  if [ -n "$file" ]; then
    if [ "$file" = "-" ]; then
      $PYTHON - "$AGENT_ID" "$field" <<'PY'
import json, sys
agent_id, field = sys.argv[1], sys.argv[2]
content = sys.stdin.read().lstrip("\ufeff")
print(json.dumps({"devAgentId": int(agent_id), field: content}, ensure_ascii=False))
PY
    else
      $PYTHON - "$AGENT_ID" "$field" "$file" <<'PY'
import json, sys, pathlib
agent_id, field, file_path = sys.argv[1:4]
content = pathlib.Path(file_path).read_text(encoding="utf-8-sig")
print(json.dumps({"devAgentId": int(agent_id), field: content}, ensure_ascii=False))
PY
    fi
  else
    $PYTHON - "$AGENT_ID" "$field" "$text" <<'PY'
import json, sys
agent_id, field, content = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"devAgentId": int(agent_id), field: content}, ensure_ascii=False))
PY
  fi
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
    text=""; file=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --text) text="$2"; shift 2 ;;
        --file) file="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    require_agent
    body="$(build_update_body "systemPrompt" "$text" "$file")"
    post "/config/update" "$body"; echo
    ;;

  update-opening)
    text=""; file=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --text) text="$2"; shift 2 ;;
        --file) file="$2"; shift 2 ;;
        *) die "未知参数：$1" ;;
      esac
    done
    require_agent
    body="$(build_update_body "openingChatMsg" "$text" "$file")"
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
    resolve_python
    # 逐字段拼装，跳过空值字段
    body=$($PYTHON - "$dev_space" "$kw" "$page" "$page_size" <<'PY'
import json, sys
dev_space, kw, page, page_size = sys.argv[1:5]
d = {"devSpaceId": int(dev_space)}
if kw:        d["kw"] = kw
if page:      d["page"] = int(page)
if page_size: d["pageSize"] = int(page_size)
print(json.dumps(d, ensure_ascii=False))
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
