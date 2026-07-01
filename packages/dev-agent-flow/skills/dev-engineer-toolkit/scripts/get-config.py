#!/usr/bin/env python3
"""get-config.py — 读取 dev Agent 配置（UTF-8 安全，跨平台）。"""

from __future__ import annotations

import argparse
import json
import sys

from dev_http import (
    configure_stdio_utf8,
    dev_agent_id,
    api_request,
    ensure_http_ok,
)


VALID_KEYS = ("systemPrompt", "openingChatMsg", "tools", "skills", "mcpConfigs")


def print_key(data: dict, key: str) -> None:
    val = data.get(key)
    if val is None:
        return
    if key in ("tools", "skills", "mcpConfigs") and isinstance(val, list):
        if key == "tools":
            print(f"=== 已注册工具 ({len(val)} 个) ===")
            for item in val:
                print(
                    f"  [{item.get('targetType', '')}] "
                    f"#{item.get('targetId', '')} {item.get('name', '')}"
                )
        elif key == "skills":
            print(f"=== 已注册技能 ({len(val)} 个) ===")
            for item in val:
                print(f"  #{item.get('id', '')} {item.get('name', '')}")
                if item.get("downloadUrl"):
                    print(f"    下载: {item['downloadUrl']}")
        else:
            print(f"=== MCP 配置 ({len(val)} 个) ===")
            for item in val:
                print(f"  {item.get('name', '')} - {item.get('description', '') or ''}")
    elif isinstance(val, str):
        print(val)
    else:
        print(json.dumps(val, ensure_ascii=False, indent=2))


def print_all(data: dict, agent_id: int) -> None:
    sp = data.get("systemPrompt", "") or ""
    ocm = data.get("openingChatMsg", "") or ""
    tools = data.get("tools", []) or []
    skills = data.get("skills", []) or []
    mcps = data.get("mcpConfigs", []) or []

    print("========================================")
    print(f"  智能体 #{agent_id} 配置信息")
    print("========================================")
    print()
    print("--- 系统提示词 ---")
    print(sp if sp else "(未设置)")
    print()
    print("--- 开场白 ---")
    print(ocm if ocm else "(未设置)")
    print()
    print(f"--- 已注册工具 ({len(tools)} 个) ---")
    for item in tools:
        print(
            f"  [{item.get('targetType', '')}] "
            f"#{item.get('targetId', '')} {item.get('name', '')}"
        )
    print()
    print(f"--- 已注册技能 ({len(skills)} 个) ---")
    for item in skills:
        print(f"  #{item.get('id', '')} {item.get('name', '')}")
        if item.get("downloadUrl"):
            print(f"    下载: {item['downloadUrl']}")
    print()
    print(f"--- MCP 配置 ({len(mcps)} 个) ---")
    for item in mcps:
        print(f"  {item.get('name', '')} - {item.get('description', '') or '?'}")


def main() -> None:
    configure_stdio_utf8()

    p = argparse.ArgumentParser(description="获取智能体项目配置")
    p.add_argument("--key", default="")
    args = p.parse_args()

    if args.key and args.key not in VALID_KEYS:
        print(f"[ERROR] --key 无效: {args.key}", file=sys.stderr)
        print(f"可选值: {', '.join(VALID_KEYS)}", file=sys.stderr)
        sys.exit(1)

    aid = dev_agent_id()
    status, payload = api_request("GET", f"/config/{aid}")
    ensure_http_ok(status, payload)
    data = payload.get("data") or {}

    if args.key:
        print_key(data, args.key)
    else:
        print_all(data, aid)


if __name__ == "__main__":
    main()
