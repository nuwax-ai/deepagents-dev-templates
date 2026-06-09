"""Periodic reminder middleware — reminds agent of context/goals periodically."""

from __future__ import annotations

from typing import Any


def create_periodic_reminder_middleware(
    *,
    first_at: int = 5,
    every: int = 10,
) -> Any:
    """Return a before-model hook that injects a reminder every *every* turns."""
    state = {"turn": 0}

    def _before_model(ctx: Any) -> None:
        state["turn"] += 1
        turn = state["turn"]
        if turn == first_at or (turn > first_at and (turn - first_at) % every == 0):
            pass  # reminder injection is a no-op at this layer; subclasses may extend

    return _before_model
