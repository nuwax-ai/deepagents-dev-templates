"""Slash command type definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SlashCommand:
    name: str
    description: str
    usage: str = ""
    aliases: list[str] = field(default_factory=list)


@dataclass
class CommandContext:
    environment: str  # "cli" | "acp"
    tools: list[dict[str, Any]] = field(default_factory=list)
    config: Any = None
    workspaceRoot: str = ""
    sessionId: str = ""
    mode: str = ""
    clearScreen: Any = None
    saveHistory: Any = None


@dataclass
class CommandResult:
    text: str = ""
    kind: str = "text"  # "text" | "exit" | "error"
