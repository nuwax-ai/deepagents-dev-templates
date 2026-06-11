"""Agent memory tool — persistent markdown entries under ``.agent-memory/``."""

from __future__ import annotations

import os
from pathlib import Path

from langchain_core.tools import tool


def _root() -> Path:
    return Path(os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd())) / ".agent-memory"


@tool
def agent_memory(operation: str, key: str | None = None, value: str | None = None) -> str:
    """Read or write persistent agent memory entries (markdown files under ``.agent-memory/``).

    Args:
        operation: One of ``read``, ``write``, ``list``.
        key: Entry name (required for read/write).
        value: Markdown content (required for ``write``).
    """
    root = _root()
    if operation == "list":
        if not root.exists():
            return "(no memory entries)"
        return "\n".join(sorted(p.stem for p in root.glob("*.md"))) or "(no memory entries)"

    if not key:
        return "key is required for read/write"
    path = root / f"{key}.md"

    if operation == "read":
        return path.read_text(encoding="utf-8") if path.exists() else f"(no memory entry: {key})"
    if operation == "write":
        root.mkdir(parents=True, exist_ok=True)
        path.write_text(value or "", encoding="utf-8")
        return f"wrote memory entry: {key}"
    return f"unknown operation: {operation!r} (use read|write|list)"
