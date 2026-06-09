"""Agent memory tool — read/write agent memory."""

from __future__ import annotations

from typing import Any


def create_agent_memory_tool() -> dict[str, Any]:
    return {
        "name": "agent_memory",
        "description": "Read or write agent memory entries",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["read", "write", "list"]},
                "key": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["operation"],
        },
    }
