#!/usr/bin/env python3
"""search-tools.py — 搜索平台工具/API 或技能（UTF-8 安全，跨平台）。"""

from __future__ import annotations

import argparse
import json
import sys

from dev_http import (
    api_request,
    configure_stdio_utf8,
    ensure_http_ok,
    normalize_shell_text,
    read_text_option,
    require_env,
)


def print_table_tool(data: list[dict]) -> None:
    print(f"共 {len(data)} 条结果")
    print("-" * 90)
    print(f"{'ID':<12} {'类型':<14} {'名称':<24} 描述")
    print("-" * 90)
    for item in data:
        tid = str(item.get("targetId", ""))[:10]
        ttype = (item.get("targetType", "") or "")[:12]
        name = (item.get("name", "") or "")[:22]
        desc = (item.get("description", "") or "")[:34]
        print(f"{tid:<12} {ttype:<14} {name:<24} {desc}")


def print_table_skill(data: list[dict]) -> None:
    print(f"共 {len(data)} 条结果")
    print("-" * 80)
    print(f"{'ID':<12} {'名称':<28} 描述")
    print("-" * 80)
    for item in data:
        tid = str(item.get("targetId", ""))[:10]
        name = (item.get("name", "") or "")[:26]
        desc = (item.get("description", "") or "")[:36]
        print(f"{tid:<12} {name:<28} {desc}")


def main() -> None:
    configure_stdio_utf8()

    p = argparse.ArgumentParser(description="搜索平台工具/API 或技能")
    p.add_argument("--type", required=True, choices=("tool", "skill"))
    p.add_argument("--kw", default="")
    p.add_argument("--kw-file", default="", help="从 UTF-8 文件读取关键词（避免 shell 编码问题）")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--page-size", type=int, default=20)
    p.add_argument("--format", choices=("json", "table"), default="json")
    args = p.parse_args()

    if args.page < 1:
        print("[ERROR] --page 必须是正整数。", file=sys.stderr)
        sys.exit(1)
    if args.page_size < 1 or args.page_size > 100:
        print("[ERROR] --page-size 必须是 1-100 之间的整数。", file=sys.stderr)
        sys.exit(1)

    kw = read_text_option(args.kw or None, args.kw_file or None, "kw").strip()
    if kw and not args.kw_file:
        kw = normalize_shell_text(kw)

    dev_space_id = int(require_env("DEV_SPACE_ID"))
    body: dict = {"devSpaceId": dev_space_id, "type": args.type}
    if kw:
        body["kw"] = kw
    if args.page > 1:
        body["page"] = args.page
    if args.page_size != 20:
        body["pageSize"] = args.page_size

    status, payload = api_request("POST", "/tool/search", body)
    ensure_http_ok(status, payload)
    data = payload.get("data") or []

    if args.format == "table":
        if args.type == "tool":
            print_table_tool(data)
        else:
            print_table_skill(data)
    else:
        print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
