"""Harness lifecycle middleware — tracks turn start/end/fail."""

from __future__ import annotations

from typing import Any


def create_harness_lifecycle_middleware() -> Any:
    """Return a before-model hook that records turn lifecycle events."""

    def _before_model(ctx: Any) -> None:
        pass  # lifecycle tracking is handled via storage layer in full deployment

    return _before_model
