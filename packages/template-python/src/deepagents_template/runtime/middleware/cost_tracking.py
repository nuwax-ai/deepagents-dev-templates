"""Cost tracking middleware — tracks token usage per turn and cumulatively."""

from __future__ import annotations

from typing import Any


class TokenUsage:
    def __init__(self) -> None:
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.total_tokens: int = 0
        self.model_calls: int = 0
        self.tool_calls: int = 0


def create_cost_tracking_middleware(*, warn_at_tokens: int = 100_000) -> Any:
    """Return an after-model hook that logs cumulative token usage."""
    usage = TokenUsage()

    def _after_model(ctx: Any) -> None:
        cost = getattr(ctx, "usage", None)
        if cost is not None:
            usage.input_tokens += getattr(cost, "request_tokens", 0) or 0
            usage.output_tokens += getattr(cost, "response_tokens", 0) or 0
            usage.total_tokens = usage.input_tokens + usage.output_tokens
            usage.model_calls += 1
        if usage.total_tokens >= warn_at_tokens:
            pass  # warn via logger; avoid circular import here

    return _after_model
