#!/usr/bin/env python3
"""update-config.py — 更新 dev Agent 系统提示词 / 开场白（UTF-8 安全，跨平台）。

用法:
  python3 update-config.py --system-prompt "..."
  python3 update-config.py --system-prompt-file prompts/flow.base.md
  python3 update-config.py --opening-msg-file welcome.txt
"""

from __future__ import annotations

import argparse
import sys

from dev_http import (
    configure_stdio_utf8,
    dev_agent_id,
    api_request,
    ensure_http_ok,
    read_text_option,
)


def main() -> None:
    configure_stdio_utf8()

    p = argparse.ArgumentParser(description="更新智能体项目配置（systemPrompt / openingChatMsg）")
    p.add_argument("--system-prompt", default="")
    p.add_argument("--system-prompt-file", default="")
    p.add_argument("--opening-msg", default="")
    p.add_argument("--opening-msg-file", default="")
    args = p.parse_args()

    system_prompt = read_text_option(
        args.system_prompt or None,
        args.system_prompt_file or None,
        "systemPrompt",
    )
    opening_msg = read_text_option(
        args.opening_msg or None,
        args.opening_msg_file or None,
        "openingChatMsg",
    )

    if not system_prompt and not opening_msg:
        print(
            "[ERROR] 至少需要指定 --system-prompt / --system-prompt-file / "
            "--opening-msg / --opening-msg-file 之一。",
            file=sys.stderr,
        )
        sys.exit(1)

    body: dict = {"devAgentId": dev_agent_id()}
    if system_prompt:
        body["systemPrompt"] = system_prompt
        if args.system_prompt_file:
            print(
                f"[INFO] 从文件读取 systemPrompt: {args.system_prompt_file} "
                f"({len(system_prompt)} 字符)",
                file=sys.stderr,
            )
    if opening_msg:
        body["openingChatMsg"] = opening_msg
        if args.opening_msg_file:
            print(
                f"[INFO] 从文件读取 openingChatMsg: {args.opening_msg_file} "
                f"({len(opening_msg)} 字符)",
                file=sys.stderr,
            )

    status, payload = api_request("POST", "/config/update", body)
    ensure_http_ok(status, payload)

    print("[OK] 配置更新成功")
    if system_prompt:
        print(f"  已更新 systemPrompt ({len(system_prompt)} 字符)")
    if opening_msg:
        print(f"  已更新 openingChatMsg ({len(opening_msg)} 字符)")


if __name__ == "__main__":
    main()
