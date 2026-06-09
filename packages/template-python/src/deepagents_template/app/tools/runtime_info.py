"""Runtime info tool — returns runtime configuration and environment info."""

from __future__ import annotations

from typing import Any


def create_runtime_info_tool() -> dict[str, Any]:
    return {
        "name": "runtime_info",
        "description": "Get runtime configuration and environment information",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    }
