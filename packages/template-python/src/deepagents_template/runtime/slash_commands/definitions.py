"""Built-in slash command definitions."""

from __future__ import annotations

from deepagents_template.runtime.slash_commands.types import SlashCommand

BUILTIN_COMMANDS: list[SlashCommand] = [
    SlashCommand(name="/help", description="Show available commands", usage="/help"),
    SlashCommand(name="/tools", description="List available tools", usage="/tools"),
    SlashCommand(name="/config", description="Show current configuration", usage="/config"),
    SlashCommand(name="/clear", description="Clear the screen", usage="/clear"),
    SlashCommand(
        name="/save", description="Save conversation history to a JSON file", usage="/save <path>"
    ),
    SlashCommand(name="/exit", description="Exit the REPL", usage="/exit", aliases=["/quit"]),
]


def list_builtin_commands() -> list[SlashCommand]:
    return list(BUILTIN_COMMANDS)
