"""Slash command result rendering helpers."""

from __future__ import annotations

from deepagents_template.runtime.slash_commands.types import CommandResult


def render_command_result(result: CommandResult) -> str:
    return result.text


def render_help() -> str:
    from deepagents_template.runtime.slash_commands.definitions import BUILTIN_COMMANDS

    lines = ["Available commands:"]
    for c in BUILTIN_COMMANDS:
        lines.append(f"  {c.usage or c.name:<25} {c.description}")
    return "\n".join(lines)


# camelCase aliases
renderCommandResult = render_command_result
renderHelp = render_help
