"""Protected paths middleware — blocks writes to protected paths."""

from __future__ import annotations

import fnmatch
from typing import Any


def create_protected_paths_middleware(*, denied_globs: list[str]) -> Any:
    """Return a before-tool hook that raises if a write targets a denied glob."""

    def _before_tool(ctx: Any) -> None:
        if not denied_globs:
            return
        tool_name: str = getattr(ctx, "tool_name", "") or ""
        if "write" not in tool_name.lower() and "edit" not in tool_name.lower():
            return
        tool_args: dict[str, Any] = getattr(ctx, "tool_args", {}) or {}
        path = str(tool_args.get("path") or tool_args.get("file_path") or "")
        if not path:
            return
        for pattern in denied_globs:
            if fnmatch.fnmatch(path, pattern):
                raise PermissionError(
                    f"Write to '{path}' blocked by protected-paths policy ({pattern})"
                )

    return _before_tool
