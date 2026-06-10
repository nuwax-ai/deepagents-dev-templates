"""Slash command handling for ACP server.

Provides registration and routing of slash commands (``/help``, ``/clear``,
etc.) that are intercepted before reaching the agent.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# Type for slash command handlers — async function returning response text.
SlashCommandHandler = Callable[[str, dict[str, Any]], Coroutine[Any, Any, str]]


@dataclass
class SlashCommand:
    """A registered slash command."""

    name: str
    description: str
    handler: SlashCommandHandler


class SlashCommandRegistry:
    """Registry and router for slash commands."""

    def __init__(self) -> None:
        self._commands: dict[str, SlashCommand] = {}
        self._register_builtin_commands()

    def _register_builtin_commands(self) -> None:
        """Register built-in slash commands."""

        async def _help(text: str, ctx: dict[str, Any]) -> str:
            lines = ["Available commands:"]
            for cmd in sorted(self._commands.values(), key=lambda c: c.name):
                lines.append(f"  /{cmd.name} — {cmd.description}")
            return "\n".join(lines)

        async def _clear(text: str, ctx: dict[str, Any]) -> str:
            return "Session cleared."

        async def _status(text: str, ctx: dict[str, Any]) -> str:
            parts = [f"Session: {ctx.get('session_id', 'unknown')}"]
            if ctx.get("model"):
                parts.append(f"Model: {ctx['model']}")
            if ctx.get("cwd"):
                parts.append(f"CWD: {ctx['cwd']}")
            parts.append(f"Messages: {ctx.get('message_count', 0)}")
            return "\n".join(parts)

        self.register(
            SlashCommand(name="help", description="Show available commands", handler=_help)
        )
        self.register(
            SlashCommand(name="clear", description="Clear session history", handler=_clear)
        )
        self.register(
            SlashCommand(name="status", description="Show session status", handler=_status)
        )

    def register(self, command: SlashCommand) -> None:
        """Register a slash command."""
        self._commands[command.name] = command

    def register_command(
        self,
        name: str,
        description: str,
        handler: SlashCommandHandler,
    ) -> None:
        """Convenience: register a command by components."""
        self.register(SlashCommand(name=name, description=description, handler=handler))

    def get(self, name: str) -> SlashCommand | None:
        """Look up a command by name."""
        return self._commands.get(name)

    def list(self) -> list[SlashCommand]:
        """Return all registered commands."""
        return list(self._commands.values())

    def list_specs(self) -> list[dict[str, str]]:
        """Return command specs for ACP ``available_commands_update``.

        ACP ``AvailableCommand.name`` expects a bare command name (no leading
        ``/``) — the leading slash is part of the user's input syntax, not the
        command identifier.
        """
        return [
            {"name": cmd.name, "description": cmd.description}
            for cmd in sorted(self._commands.values(), key=lambda c: c.name)
        ]

    def is_slash_command(self, text: str) -> bool:
        """Check if text starts with a registered slash command."""
        if not text.startswith("/"):
            return False
        cmd_name = text[1:].split()[0].lower()
        return cmd_name in self._commands

    async def handle(self, text: str, ctx: dict[str, Any]) -> str | None:
        """Route a slash command to its handler.

        Returns the response text, or None if the text is not a slash command.
        Supports both async and sync handlers — sync handlers are called
        directly, async handlers are awaited.
        """
        if not text.startswith("/"):
            return None

        cmd_name = text[1:].split()[0].lower()
        cmd = self._commands.get(cmd_name)
        if cmd is None:
            return f"Unknown command: /{cmd_name}. Type /help for available commands."

        result = cmd.handler(text, ctx)
        if asyncio.iscoroutine(result):
            return await result
        return result
