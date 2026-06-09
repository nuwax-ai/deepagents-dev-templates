#!/usr/bin/env python3
"""DeepAgents Dev Templates — Multi-mode Entry Point.

Mirrors the TypeScript template's ``src/index.ts`` command dispatch surface.
Supports the following modes:

==================  ==========================================================
Command             Description
==================  ==========================================================
(default)           Start ACP server (stdio transport) — for nuwaclaw/Zed
``acp``             Explicitly start the ACP server
``chat``            Start an interactive REPL in the terminal
``ask "<prompt>"``  One-shot prompt
``run <file>``      Run a prompt read from a file
``graph [out.json]`` Generate the code relationship graph JSON
==================  ==========================================================

Common flags
------------
* ``--debug``  enable debug-level logging
* ``--config <path>`` use a custom config file
* ``--prompt-file <path>`` / ``--system-prompt <s>`` override the system prompt
* ``--cwd <path>`` set the project workspace root
* ``--no-acp``  force non-ACP mode
* ``--help`` / ``-h`` show usage
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from deepagents_template.runtime.logger import logger

HELP_TEXT = """
DeepAgents Dev Templates (Python) — Multi-mode Entry Point

用法:
  deepagents-app [command] [args] [flags]

命令:
  (default)              启动 ACP 服务器 (stdio 协议)
  acp                    显式启动 ACP 服务器
  chat                   启动交互式 REPL (终端对话模式)
  ask "<prompt>"         单次提问并打印回答
  run <file>             从文件读取 prompt 并执行
  graph [output.json]    生成代码节点关系图 JSON

标志:
  --debug                启用 debug 级别日志
  --config <path>        使用自定义配置文件
  --prompt-file <path>   使用自定义系统提示词文件
  --system-prompt <s>    直接指定系统提示词
  --cwd <path>           指定项目工作目录
  --no-acp               禁用 ACP 模式
  --help, -h             显示此帮助

示例:
  deepagents-app                            # ACP 服务器
  deepagents-app chat --debug               # REPL 调试模式
  deepagents-app ask "hello world"          # 单次问答
  deepagents-app run prompt.md              # 从文件运行
  deepagents-app graph                      # 输出节点关系图 JSON
"""


@dataclass
class CliOptions:
    """Options consumed by surface entry points (REPL / one-shot / graph)."""

    config_path: str | None = None
    prompt_file: str | None = None
    system_prompt: str | None = None
    workspace_root: str | None = None


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="deepagents-app",
        description=HELP_TEXT.strip(),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        add_help=False,
    )
    p.add_argument("command", nargs="?")
    p.add_argument("command_arg", nargs="?")
    p.add_argument("--debug", action="store_true")
    p.add_argument("--no-acp", action="store_true")
    p.add_argument("--config")
    p.add_argument("--prompt-file")
    p.add_argument("--system-prompt")
    p.add_argument("--cwd", "--working-dir", dest="cwd")
    p.add_argument("-h", "--help", action="store_true")
    return p


def _load_env(config_path: str | None, *, acp: bool) -> None:
    """Load ``.env`` as a fallback when no API key is already set.

    In ACP mode the host (Zed / nuwaclaw) supplies the model credentials, so we
    only fall back to ``.env`` when none of ``ANTHROPIC_API_KEY``,
    ``ANTHROPIC_AUTH_TOKEN`` or ``OPENAI_API_KEY`` are already in the
    environment. ``dotenv`` does not overwrite existing variables.
    """
    has_cred = any(
        os.environ.get(k)
        for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY")
    )
    if not acp or not has_cred:
        env_path = (
            Path(config_path).parent / ".env"
            if config_path
            else Path.cwd() / ".env"
        )
        if env_path.exists():
            load_dotenv(env_path, override=False)


def _warn_if_no_credential() -> None:
    if not any(
        os.environ.get(k)
        for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY")
    ):
        print(
            "\033[33m⚠️  警告: 未设置 ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN"
            " 或 OPENAI_API_KEY\033[0m",
            file=sys.stderr,
        )
        print(
            "\033[33m   Agent 将无法调用 LLM。请在 .env 文件中设置至少一个。\033[0m",
            file=sys.stderr,
        )


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entry point — returns a process exit code."""
    args_list = list(sys.argv[1:] if argv is None else argv)
    parser = _build_parser()
    ns = parser.parse_args(args_list)

    if ns.help:
        print(HELP_TEXT)
        return 0

    command = ns.command or "acp"
    command_arg = ns.command_arg
    acp = command == "acp" and not ns.no_acp

    if ns.debug:
        os.environ["LOG_LEVEL"] = "debug"

    _load_env(ns.config, acp=acp)

    # Prefer API-key auth over a stale ANTHROPIC_AUTH_TOKEN that the SDK would
    # also send. Mirrors the TypeScript template's behaviour.
    if os.environ.get("ANTHROPIC_API_KEY"):
        os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)

    _warn_if_no_credential()

    workspace_root = (
        str(Path(ns.cwd).resolve())
        if ns.cwd
        else None
    )

    cli_options = CliOptions(
        config_path=ns.config,
        prompt_file=ns.prompt_file,
        system_prompt=ns.system_prompt,
        workspace_root=workspace_root,
    )

    log = logger.child("main")
    log.info(
        "Bootstrapping DeepAgents (Python)",
        extra={
            "command": command,
            "acp": acp,
            "workspaceRoot": workspace_root or "(unset)",
        },
    )

    try:
        if command == "acp":
            from deepagents_template.surfaces.acp.server import bootstrap

            bootstrap(
                acp=True,
                debug=ns.debug,
                config_path=ns.config,
                workspace_root=workspace_root,
            )
            return 0

        if command == "chat":
            from deepagents_template.surfaces.cli.repl import start_repl

            start_repl(cli_options)
            return 0

        if command == "ask":
            if not command_arg:
                print("Error: 'ask' requires a prompt argument", file=sys.stderr)
                print(
                    'Usage: deepagents-app ask "your question"',
                    file=sys.stderr,
                )
                return 1
            from deepagents_template.surfaces.cli.one_shot import run_one_shot

            return run_one_shot(command_arg, cli_options)

        if command == "run":
            if not command_arg:
                print("Error: 'run' requires a file path", file=sys.stderr)
                print(
                    "Usage: deepagents-app run <prompt-file>",
                    file=sys.stderr,
                )
                return 1
            from deepagents_template.surfaces.cli.one_shot import run_prompt_file

            return run_prompt_file(command_arg, cli_options)

        if command == "graph":
            from deepagents_template.runtime.code_graph import (
                generate_code_graph,
                write_code_graph,
            )

            if command_arg:
                write_code_graph(command_arg)
                print(f"Code graph written to {command_arg}")
            else:
                print(json.dumps(generate_code_graph(), indent=2, default=str))
            return 0

        # Fallback: treat the unrecognised positional as a one-shot prompt.
        from deepagents_template.surfaces.cli.one_shot import run_one_shot

        return run_one_shot(command, cli_options)
    except KeyboardInterrupt:
        log.info("Interrupted by user")
        return 130
    except Exception as exc:
        log.exception("Fatal error: %s", exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
