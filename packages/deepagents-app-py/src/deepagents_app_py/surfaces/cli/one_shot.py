"""One-shot CLI — single prompt execution against the deepagents graph."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from deepagents_app_py.runtime.logger import logger


def _message_text(content: Any) -> str:
    """Extract plain text from a LangChain message ``content`` (str or blocks)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content)


def run_one_shot(prompt: str, options: Any = None) -> int:
    """Run a single prompt through the agent and print the final response."""
    log = logger.child("one-shot")
    log.info("Running one-shot prompt", prompt=prompt[:100])

    from deepagents_app_py.app.tools import collect_tools
    from deepagents_app_py.runtime.agent_config import build_graph
    from deepagents_app_py.runtime.config.config_loader import loadConfig

    ws = getattr(options, "workspace_root", None) or os.getcwd()
    config = loadConfig(
        {"workspaceRoot": ws, "configPath": getattr(options, "config_path", None)}
    )

    # One-shot: no checkpointer (no thread to persist).
    graph = build_graph(config, None, ws, collect_tools(), checkpointer=False)

    try:
        result = graph.invoke({"messages": [{"role": "user", "content": prompt}]})
    except Exception as exc:  # noqa: BLE001 — report cleanly to the user
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    messages = result.get("messages", []) if isinstance(result, dict) else []
    if messages:
        print(_message_text(messages[-1].content))
    return 0


def run_prompt_file(file_path: str, options: Any = None) -> int:
    """Read a prompt from a file and execute it."""
    log = logger.child("one-shot")
    try:
        content = Path(file_path).read_text(encoding="utf-8")
        log.info("Running prompt from file", file=file_path, length=len(content))
        return run_one_shot(content, options)
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Error reading file {file_path}: {exc}", file=sys.stderr)
        return 1
