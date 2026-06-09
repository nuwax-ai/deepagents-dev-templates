"""Slash command barrel — re-exports the split modules.

Mirrors the TS template's ``runtime/slash-commands.ts`` barrel that
combines :mod:`slash_commands.types`, :mod:`slash_commands.definitions`,
:mod:`slash_commands.execution` and :mod:`slash_commands.rendering`.
"""

from __future__ import annotations

from deepagents_template.runtime.slash_commands.definitions import (
    BUILTIN_COMMANDS,
    list_builtin_commands,
)
from deepagents_template.runtime.slash_commands.execution import (
    SlashCommandError,
    execute_command,
)
from deepagents_template.runtime.slash_commands.rendering import (
    render_command_result,
    render_help,
)
from deepagents_template.runtime.slash_commands.types import (
    CommandContext,
    CommandResult,
    SlashCommand,
)

__all__ = [
    "BUILTIN_COMMANDS",
    "CommandContext",
    "CommandResult",
    "SlashCommand",
    "SlashCommandError",
    "execute_command",
    "list_builtin_commands",
    "render_command_result",
    "render_help",
]
