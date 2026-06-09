"""Platform API tool — calls the nuwax platform API."""

from __future__ import annotations

from typing import Any


def create_platform_api_tool() -> dict[str, Any]:
    return {
        "name": "platform_api",
        "description": "Call the nuwax platform API endpoint",
        "parameters": {
            "type": "object",
            "properties": {
                "endpoint": {"type": "string", "description": "API endpoint name"},
                "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"]},
                "body": {"type": "object"},
            },
            "required": ["endpoint"],
        },
    }
