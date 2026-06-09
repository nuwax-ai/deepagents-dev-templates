"""Stuck loop detection middleware — detects and breaks agent loops."""

from __future__ import annotations

from collections import deque
from typing import Any


def create_stuck_loop_middleware(
    *,
    threshold: int = 3,
    mode: str = "warn",
) -> Any:
    """Return an after-tool hook that detects repeated identical tool calls."""
    recent: deque[str] = deque(maxlen=threshold)

    def _after_tool(ctx: Any) -> None:
        tool_name: str = getattr(ctx, "tool_name", "") or ""
        recent.append(tool_name)
        if len(recent) == threshold and len(set(recent)) == 1:
            msg = f"[stuck-loop] Agent called '{tool_name}' {threshold} times in a row."
            if mode == "error":
                raise RuntimeError(msg)

    return _after_tool
