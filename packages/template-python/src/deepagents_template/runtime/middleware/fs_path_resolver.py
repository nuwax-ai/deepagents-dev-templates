"""Filesystem path resolver middleware — resolves relative paths in tool args."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def resolve_fs_path(path: str, workspace_root: str) -> str:
    p = Path(path)
    if p.is_absolute():
        return str(p)
    return str(Path(workspace_root) / p)


def create_fs_path_resolver(workspace_root: str) -> Any:
    """Return a before-tool hook that resolves workspace-relative paths to absolute."""

    def _before_tool(ctx: Any) -> None:
        tool_args: dict[str, Any] = getattr(ctx, "tool_args", None) or {}
        for key in ("path", "file_path", "directory"):
            val = tool_args.get(key)
            if isinstance(val, str) and val and not Path(val).is_absolute():
                tool_args[key] = resolve_fs_path(val, workspace_root)

    return _before_tool
