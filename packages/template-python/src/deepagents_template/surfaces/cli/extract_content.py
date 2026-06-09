"""Content extraction helper — extracts text content from agent responses."""

from __future__ import annotations

from typing import Any


def extract_content(response: Any) -> str:
    """Extract text content from an agent response."""
    if response is None:
        return ""
    if isinstance(response, str):
        return response
    if isinstance(response, dict):
        content = response.get("content", response.get("text", ""))
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
            return "\n".join(parts)
        return str(content)
    return str(response)
