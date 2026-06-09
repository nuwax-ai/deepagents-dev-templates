"""HTTP request tool — makes HTTP requests via httpx."""

from __future__ import annotations

from typing import Any


def create_http_request_tool() -> dict[str, Any]:
    return {
        "name": "http_request",
        "description": "Make an HTTP request to a given URL",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to request"},
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PUT", "DELETE"],
                    "default": "GET",
                },
            },
            "required": ["url"],
        },
    }
