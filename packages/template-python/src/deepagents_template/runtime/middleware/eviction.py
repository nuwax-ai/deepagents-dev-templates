"""Large output eviction — replaces oversized tool outputs with previews."""

from __future__ import annotations

from typing import Any


def should_evict(content: str, config: Any) -> bool:
    if not getattr(config, "enabled", True):
        return False
    char_per_token = getattr(config, "char_per_token", 4.0)
    token_limit = getattr(config, "token_limit", 20_000)
    estimated_tokens = len(content) / char_per_token
    return estimated_tokens > token_limit


def create_preview(
    content: str, head_lines: int = 5, tail_lines: int = 5
) -> str:
    lines = content.split("\n")
    if len(lines) <= head_lines + tail_lines:
        return content
    head = "\n".join(lines[:head_lines])
    tail = "\n".join(lines[-tail_lines:])
    omitted = len(lines) - head_lines - tail_lines
    return f"{head}\n\n... [{omitted} lines truncated] ...\n\n{tail}"


def create_eviction_middleware(*, config: Any) -> Any:
    """Return an after-tool hook that truncates oversized outputs."""

    def _after_tool(ctx: Any) -> None:
        result = getattr(ctx, "tool_result", None)
        if result is None:
            return
        content = str(result)
        if should_evict(content, config):
            preview = create_preview(
                content,
                head_lines=getattr(config, "head_lines", 5),
                tail_lines=getattr(config, "tail_lines", 5),
            )
            if hasattr(ctx, "tool_result"):
                ctx.tool_result = preview

    return _after_tool
