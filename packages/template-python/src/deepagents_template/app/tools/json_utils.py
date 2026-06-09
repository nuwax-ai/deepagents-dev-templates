"""JSON utils tool — JSON manipulation utilities."""

from __future__ import annotations

from typing import Any


def create_json_utils_tool() -> dict[str, Any]:
    return {
        "name": "json_utils",
        "description": "JSON utilities for parsing, formatting, and merging",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["parse", "stringify", "merge", "validate"],
                },
                "json_input": {"type": "string"},
            },
            "required": ["operation", "json_input"],
        },
    }
