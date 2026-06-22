#!/usr/bin/env python3
"""agent_tool.py — 已弃用，请使用同目录 agent_tool.sh（nuwaclaw / Git Bash 统一入口）。

保留本文件仅供无 bash 时的备选；新用法勿再依赖此脚本。

封装 4sandbox/agent/dev/* 全部端点。使用标准库，无第三方依赖。
所有 JSON 请求/响应统一 UTF-8，避免 Windows 下中文 systemPrompt 乱码。

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
    python3 agent_tool.py update-prompt --file prompts/weather.md
    python3 agent_tool.py update-opening --text "你好"

任何写操作后，请自行调用 config 验证。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_PATH = "/api/v1/4sandbox/agent/dev"
VALID_TYPES = {"Plugin", "Workflow", "Knowledge"}


def configure_stdio_utf8() -> None:
    """Windows 控制台回显中文时尽量使用 UTF-8。"""
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass


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


def read_text_arg(text: str | None, file_path: str | None) -> str:
    if text and file_path:
        sys.exit("ERROR: --text 与 --file 不能同时使用")
    if file_path:
        path = Path(file_path)
        if file_path == "-":
            return sys.stdin.read().lstrip("\ufeff")
        if not path.is_file():
            sys.exit(f"ERROR: 文件不存在：{file_path}")
        return path.read_text(encoding="utf-8-sig")
    if text is None:
        sys.exit("ERROR: 需要 --text \"...\" 或 --file <path>（- 表示 stdin）")
    return text


def call(method: str, path: str, body: dict | None = None) -> None:
    base = env("PLATFORM_BASE_URL", required=True)
    token = env("SANDBOX_ACCESS_KEY", required=True)
    url = f"{base}{API_PATH}{path}"
    data = (
        json.dumps(body, ensure_ascii=False).encode("utf-8")
        if body is not None
        else None
    )
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
            print(raw.decode(charset, errors="replace"))
    except urllib.error.HTTPError as e:
        err_body = e.read()
        try:
            print(err_body.decode("utf-8"), file=sys.stderr)
        except Exception:
            print(err_body, file=sys.stderr)
        sys.exit(1)


def add_text_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--text", help="文本内容（短文本）")
    group.add_argument("--file", help="UTF-8 文本文件路径；- 表示从 stdin 读取")


def main() -> None:
    configure_stdio_utf8()

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
    add_text_args(up)

    uo = sub.add_parser("update-opening", help="更新开场白")
    add_text_args(uo)

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
        text = read_text_arg(getattr(args, "text", None), getattr(args, "file", None))
        call("POST", "/config/update", {"devAgentId": agent_id(), "systemPrompt": text})
    elif args.cmd == "update-opening":
        text = read_text_arg(getattr(args, "text", None), getattr(args, "file", None))
        call("POST", "/config/update", {"devAgentId": agent_id(), "openingChatMsg": text})


if __name__ == "__main__":
    main()
