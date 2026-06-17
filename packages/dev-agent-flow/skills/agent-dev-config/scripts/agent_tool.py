#!/usr/bin/env python3
"""agent_tool.py — Agent 工具配置管理 CLI（Python 版，与 agent_tool.sh 功能对齐）。

封装 4sandbox/agent/dev/* 全部端点。使用标准库，无第三方依赖。

依赖环境变量：
    PLATFORM_BASE_URL   平台地址
    SANDBOX_ACCESS_KEY  Bearer 鉴权令牌
    DEV_AGENT_ID        开发的 Agent ID（config/update/add/del 必填）
    DEV_SPACE_ID        仅 search 必填，dev 空间 ID

用法：
    python3 agent_tool.py config
    python3 agent_tool.py search --kw 搜索
    python3 agent_tool.py add-tool --type Plugin --id 611
    python3 agent_tool.py del-tool --type Plugin --id 611
    python3 agent_tool.py update-prompt --text "你是助手"
    python3 agent_tool.py update-opening --text "你好"

任何写操作后，请自行调用 config 验证。
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

API_PATH = "/api/v1/4sandbox/agent/dev"
VALID_TYPES = {"Plugin", "Workflow", "Knowledge"}


def env(name: str, required: bool = False) -> str:
    val = os.environ.get(name, "")
    if required and not val:
        sys.exit(f"ERROR: 缺少环境变量 {name}")
    return val


def agent_id() -> int:
    """取 DEV_AGENT_ID（必填），返回整数。"""
    val = env("DEV_AGENT_ID", required=True)
    try:
        return int(val)
    except ValueError:
        sys.exit(f"ERROR: DEV_AGENT_ID 必须是整数，得到：{val}")


def call(method: str, path: str, body: dict | None = None) -> None:
    base = env("PLATFORM_BASE_URL", required=True)
    token = env("SANDBOX_ACCESS_KEY", required=True)
    url = f"{base}{API_PATH}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description="Agent 工具配置管理 CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("config", help="获取 Agent 配置")

    sp = sub.add_parser("search", help="搜索可用工具")
    sp.add_argument("--kw", default="")
    sp.add_argument("--dev-space-id", type=int, default=None)
    sp.add_argument("--page", type=int)
    sp.add_argument("--page-size", type=int)

    add = sub.add_parser("add-tool", help="添加工具")
    add.add_argument("--type", required=True)
    add.add_argument("--id", type=int, required=True)

    dele = sub.add_parser("del-tool", help="删除工具")
    dele.add_argument("--type", required=True)
    dele.add_argument("--id", type=int, required=True)

    up = sub.add_parser("update-prompt", help="更新系统提示词")
    up.add_argument("--text", required=True)

    uo = sub.add_parser("update-opening", help="更新开场白")
    uo.add_argument("--text", required=True)

    args = p.parse_args()

    if args.cmd == "config":
        call("GET", f"/config/{agent_id()}")
    elif args.cmd == "search":
        dev_space = args.dev_space_id if args.dev_space_id is not None else env("DEV_SPACE_ID", required=True)
        body: dict = {"devSpaceId": int(dev_space)}
        if args.kw:
            body["kw"] = args.kw
        if args.page:
            body["page"] = args.page
        if args.page_size:
            body["pageSize"] = args.page_size
        call("POST", "/tool/search", body)
    elif args.cmd in ("add-tool", "del-tool"):
        if args.type not in VALID_TYPES:
            sys.exit(f"ERROR: 非法 --type：{args.type}（应为 {VALID_TYPES}）")
        path = "/config/tool/add" if args.cmd == "add-tool" else "/config/tool/delete"
        call("POST", path, {"devAgentId": agent_id(), "targetType": args.type, "targetId": args.id})
    elif args.cmd == "update-prompt":
        call("POST", "/config/update", {"devAgentId": agent_id(), "systemPrompt": args.text})
    elif args.cmd == "update-opening":
        call("POST", "/config/update", {"devAgentId": agent_id(), "openingChatMsg": args.text})


if __name__ == "__main__":
    main()
