"""Context compaction — automatically compresses old conversation history."""

from __future__ import annotations

from typing import Any


def should_compact(context_tokens: int, context_window: int, trigger_threshold: float) -> bool:
    return context_tokens >= context_window * trigger_threshold


def find_cut_point(messages: list[Any], keep_recent_tokens: int) -> int:
    if not messages:
        return 0
    token_count = 0
    for i in range(len(messages) - 1, -1, -1):
        token_count += len(str(messages[i])) // 4
        if token_count >= keep_recent_tokens:
            return max(0, i)
    return 0


def create_compaction_middleware(*, config: Any, model: Any) -> Any:
    """Return a before-model hook that summarises old messages when near context limit."""

    def _before_model(ctx: Any) -> None:
        pass  # pydantic-ai compaction is handled via summarization-pydantic-ai processor

    return _before_model
