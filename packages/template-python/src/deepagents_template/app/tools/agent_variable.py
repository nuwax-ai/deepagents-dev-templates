"""Agent variable tool — read/write agent variables via VariableManager."""

from __future__ import annotations

from typing import Any


def create_agent_variable_tool() -> dict[str, Any]:
    return {
        "name": "agent_variable",
        "description": "Read or write agent variables",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "enum": ["get", "set", "list", "delete"]},
                "key": {"type": "string"},
                "value": {"type": "string"},
            },
            "required": ["operation"],
        },
    }
