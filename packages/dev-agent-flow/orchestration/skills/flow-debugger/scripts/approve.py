#!/usr/bin/env python3
"""approve.py — 权限审批响应，严格镜像平台 permission-request/response。

当 debug.sh 执行遇到 ACP_REQUEST_PERMISSION 权限审批、未 --auto-approve 而 exit 5 时，
用本脚本响应（option-id 来自 exit 5 时列出的 options[]）：

  批准：approve.sh --tool-id <toolCallId> --option-id <allow_option_id> --outcome selected
  拒绝：approve.sh --tool-id <toolCallId> --option-id <reject_option_id> --outcome cancelled

端点：POST /conversation/chat/permission-request/response
  { conversationId, toolId(=tool_call_id), option: { optionId, outcome: 'selected'|'cancelled' } }

> ask-question（nuwax_ask_question）无专用响应端点——答案作为普通 chat 消息回流，
> 用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接（见 debug.sh）。

退出码：0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败 | 4 业务错误
"""

from __future__ import annotations

import argparse
import sys

from debug_http import (
    PERMISSION_RESPONSE_PATH,
    api_request,
    configure_stdio_utf8,
    resolve_conversation_id,
    ensure_http_ok,
)

VALID_OUTCOMES = ("selected", "cancelled")


def main() -> None:
    configure_stdio_utf8()
    p = argparse.ArgumentParser(description="权限审批响应（permission-request/response）")
    p.add_argument("--tool-id", required=True, help="tool_call_id（exit 5 时输出）")
    p.add_argument("--option-id", required=True, help="所选 option 的 option_id（exit 5 时列出）")
    p.add_argument(
        "--outcome",
        required=True,
        choices=VALID_OUTCOMES,
        help="selected=批准 | cancelled=拒绝",
    )
    p.add_argument(
        "--conversation",
        default="",
        help="会话 ID（默认 CONVERSATION_ID env，须与 debug.sh 同一会话）",
    )
    args = p.parse_args()

    cid = resolve_conversation_id(args.conversation) or ""
    if not cid:
        print("[ERROR] 需要 --conversation 或可通过 GET agent 解析 devConversationId。", file=sys.stderr)
        sys.exit(1)

    body = {
        "conversationId": cid,
        "toolId": args.tool_id,
        "option": {"optionId": args.option_id, "outcome": args.outcome},
    }
    status, payload = api_request("POST", PERMISSION_RESPONSE_PATH, body)
    ensure_http_ok(status, payload)
    print(f"[OK] 已响应权限审批：toolId={args.tool_id} outcome={args.outcome}")


if __name__ == "__main__":
    main()
