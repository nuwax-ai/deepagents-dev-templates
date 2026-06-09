"""Checkpoint tool — save/load checkpoints."""

from __future__ import annotations

from typing import Any


def create_checkpoint_tool() -> dict[str, Any]:
    return {
        "name": "checkpoint",
        "description": "Save or load agent state checkpoints",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["save", "load", "list"]},
                "name": {"type": "string"},
            },
            "required": ["operation"],
        },
    }
