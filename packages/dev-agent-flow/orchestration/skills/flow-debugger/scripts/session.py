#!/usr/bin/env python3
"""session.py — dev 调试会话管理，严格镜像平台 agent-dev 调试会话。

  refresh  拉取当前 devConversationId（GET /{devAgentId}，发 debug 前权威来源）
  wait     用户手动点「刷子」后轮询，直到 devConversationId 变化（或首次出现）
  current  获取 agent 配置全文（含 devConversationId）
  cancel   取消/停止执行（页面「停止」）
           POST /conversation/chat/stop/{conversationId}（路径参=conversationId，无 body）

  new      POST /conversation/create 新建调试会话（{agentId, devMode:true}），打印 data.id
           与 UI「刷子」等价；后端 devMode 创建会回写 agent.devConversationId，故 new 后无需额外 refresh

端点契约集中在 debug_http.py。退出码：0 成功 | 1 参数错 | 2 平台未就绪 | 3 HTTP 失败/超时 | 4 业务错误
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from debug_http import (
    AGENT_CONFIG_PATH,
    CONVERSATION_STOP_PATH,
    api_request,
    configure_stdio_utf8,
    create_dev_conversation,
    dev_agent_id,
    ensure_http_ok,
    fetch_dev_conversation_id,
    fetch_dev_conversation_id_strict,
    resolve_conversation_id,
)


def cmd_new(args) -> None:
    cid = create_dev_conversation()
    if args.quiet:
        print(cid)
    else:
        print(f"[OK] 新建调试会话 devConversationId={cid}")


def cmd_refresh(args) -> None:
    cid = fetch_dev_conversation_id_strict()
    if args.quiet:
        print(cid)
    else:
        print(f"[OK] devConversationId={cid}")


def cmd_wait(args) -> None:
    previous = (args.previous or "").strip()
    interval = max(0.5, float(args.interval))
    timeout = max(interval, float(args.timeout))
    deadline = time.monotonic() + timeout

    if previous:
        print(
            f"[等待] 用户请在预览面板点击「刷子」；轮询 devConversationId 变化（原={previous}，超时 {timeout:.0f}s）…",
            file=sys.stderr,
        )
    else:
        print(
            f"[等待] 轮询 devConversationId 出现（超时 {timeout:.0f}s）…",
            file=sys.stderr,
        )

    last_seen = previous
    while time.monotonic() < deadline:
        cid = fetch_dev_conversation_id() or ""
        if cid and cid != previous:
            if args.quiet:
                print(cid)
            else:
                print(f"[OK] devConversationId={cid}")
            return
        if cid and cid != last_seen:
            print(f"[轮询] devConversationId={cid}", file=sys.stderr)
            last_seen = cid
        time.sleep(interval)

    print(
        "[ERROR] 超时：devConversationId 未变化。请确认用户已在预览面板点击「刷子」。",
        file=sys.stderr,
    )
    if last_seen:
        print(f"[提示] 当前仍为 devConversationId={last_seen}", file=sys.stderr)
    sys.exit(3)


def cmd_current(_args) -> None:
    aid = dev_agent_id()
    path = AGENT_CONFIG_PATH.replace("{devAgentId}", str(aid))
    status, payload = api_request("GET", path)
    ensure_http_ok(status, payload)
    data = payload.get("data") or {}
    dev_conv = data.get("devConversationId") or ""
    print(f"[当前调试会话] devConversationId={dev_conv}")
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_cancel(args) -> None:
    cid = resolve_conversation_id(args.conversation)
    if not cid:
        print(
            "[ERROR] 需要 --conversation 或可通过 GET agent 解析 devConversationId。",
            file=sys.stderr,
        )
        sys.exit(1)
    path = CONVERSATION_STOP_PATH.replace("{conversationId}", str(cid))
    status, payload = api_request("POST", path)
    ensure_http_ok(status, payload)
    print(f"[OK] 已取消会话 {cid}")
    print(
        "[提示] 若继续同会话，请先用 debug.sh --wait-idle 等待终态；"
        "若要干净验证，推荐 session.sh new 或 debug.sh --new-session。",
        file=sys.stderr,
    )


def main() -> None:
    configure_stdio_utf8()
    p = argparse.ArgumentParser(description="dev 调试会话管理（new/refresh/wait/current/cancel）")
    sub = p.add_subparsers(dest="cmd", required=True)

    pn = sub.add_parser(
        "new",
        help="新建调试会话（POST /conversation/create，与 UI 刷子等价）",
    )
    pn.add_argument("--quiet", "-q", action="store_true", help="仅输出新会话 ID")
    pn.set_defaults(func=cmd_new)

    pr = sub.add_parser("refresh", help="拉取当前 devConversationId（GET agent 配置）")
    pr.add_argument("--quiet", "-q", action="store_true", help="仅输出 ID（便于脚本捕获）")
    pr.set_defaults(func=cmd_refresh)

    pw = sub.add_parser(
        "wait",
        help="用户点「刷子」后轮询，直到 devConversationId 相对 --previous 变化",
    )
    pw.add_argument(
        "--previous",
        default="",
        help="点刷子前的 devConversationId；变化即成功（空则等待首次非空）",
    )
    pw.add_argument("--timeout", type=float, default=120.0, help="超时秒数（默认 120）")
    pw.add_argument("--interval", type=float, default=2.0, help="轮询间隔秒（默认 2）")
    pw.add_argument("--quiet", "-q", action="store_true", help="仅输出新 ID")
    pw.set_defaults(func=cmd_wait)

    sub.add_parser(
        "current",
        help="获取 agent 配置全文（含 devConversationId）",
    ).set_defaults(func=cmd_current)

    pc2 = sub.add_parser("cancel", help="取消/停止会话（停止）")
    pc2.add_argument("--conversation", default="", help="会话 ID（默认自动解析 devConversationId）")
    pc2.set_defaults(func=cmd_cancel)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
