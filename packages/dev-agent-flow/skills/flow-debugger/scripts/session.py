#!/usr/bin/env python3
"""session.py — dev 调试会话管理，严格镜像平台 agent-dev 调试会话。

  new     新建会话（页面「刷子」，清空上下文开新对话）
          POST /conversation/create {agentId, devMode:true} → data.id（新 conversationId）
  current 获取当前会话内容/初始历史
          POST /conversation/{conversationId} → data.messageList[]
  cancel  取消/停止执行（页面「停止」）
          POST /conversation/chat/stop/{conversationId}（路径参=conversationId，无 body）

端点契约集中在 debug_http.py。退出码：0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败(含端点未就绪) | 4 业务错误
"""

from __future__ import annotations

import argparse
import json
import sys

from debug_http import (
    AGENT_CONFIG_PATH,
    CONVERSATION_CREATE_PATH,
    CONVERSATION_STOP_PATH,
    api_request,
    configure_stdio_utf8,
    conversation_id,
    dev_agent_id,
    ensure_http_ok,
)


def cmd_new(args) -> None:
    aid = dev_agent_id()
    status, payload = api_request(
        "POST", CONVERSATION_CREATE_PATH, {"agentId": aid, "devMode": True}
    )
    ensure_http_ok(status, payload)
    data = payload.get("data") or {}
    cid = data.get("id") or ""
    print(f"[OK] 新建会话: {cid}")
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_current(args) -> None:
    # GET agent 配置，取 devConversationId（当前调试会话 ID）
    aid = dev_agent_id()
    path = AGENT_CONFIG_PATH.replace("{devAgentId}", str(aid))
    status, payload = api_request("GET", path)
    ensure_http_ok(status, payload)
    data = payload.get("data") or {}
    dev_conv = data.get("devConversationId") or ""
    print(f"[当前调试会话] devConversationId={dev_conv}")
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_cancel(args) -> None:
    cid = args.conversation or conversation_id()
    if not cid:
        print("[ERROR] 需要 --conversation 或 CONVERSATION_ID env。", file=sys.stderr)
        sys.exit(1)
    path = CONVERSATION_STOP_PATH.replace("{conversationId}", str(cid))
    status, payload = api_request("POST", path)  # 无 body（路径参=conversationId）
    ensure_http_ok(status, payload)
    print(f"[OK] 已取消会话 {cid}")


def main() -> None:
    configure_stdio_utf8()
    p = argparse.ArgumentParser(description="dev 调试会话管理（new/current/cancel）")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("new", help="新建会话（刷子）").set_defaults(func=cmd_new)

    sub.add_parser("current", help="获取当前调试会话 ID（GET agent 配置 → devConversationId）").set_defaults(func=cmd_current)

    pc2 = sub.add_parser("cancel", help="取消/停止会话（停止）")
    pc2.add_argument("--conversation", default="", help="会话 ID（默认 CONVERSATION_ID env）")
    pc2.set_defaults(func=cmd_cancel)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
