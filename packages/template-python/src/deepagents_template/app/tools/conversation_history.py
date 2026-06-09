"""Conversation history tool — view conversation history."""

from __future__ import annotations

from typing import Any


def create_conversation_history_tool() -> dict[str, Any]:
    return {
        "name": "conversation_history",
        "description": "View the conversation history",
        "parameters": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "description": "Number of recent messages to return"},
            },
        },
    }
