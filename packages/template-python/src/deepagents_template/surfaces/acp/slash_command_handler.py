"""ACP Slash-Command Handling — intercepts / commands before they reach the LLM."""

from __future__ import annotations

from typing import Any


def handleAcpSlashCommand(options: dict[str, Any]) -> dict[str, Any] | None:
    """Intercept and handle slash commands in ACP mode."""
    text = options.get("text", "")
    if not text or not text.startswith("/"):
        return None
    result: dict[str, Any] = {"stopReason": "end_turn"}
    return result


def getAcpPromptText(prompt: list[dict[str, Any]] | None) -> str | None:
    if not prompt:
        return None
    for block in prompt:
        if block.get("type") == "text" and block.get("text"):
            return block["text"].strip()
    return None
