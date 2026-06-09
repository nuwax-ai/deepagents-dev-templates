"""Slash command execution engine."""

from __future__ import annotations

from deepagents_template.runtime.slash_commands.definitions import BUILTIN_COMMANDS
from deepagents_template.runtime.slash_commands.types import CommandContext, CommandResult


class SlashCommandError(Exception):
    """Raised when a slash command fails."""


def execute_command(cmd: str, ctx: CommandContext) -> CommandResult | None:
    """Execute a slash command. Returns None if the input is not a slash command."""
    if not cmd.startswith("/"):
        return None
    parts = cmd.split(maxsplit=1)
    cmd_name = parts[0].lower()
    cmd_arg = parts[1] if len(parts) > 1 else ""
    if cmd_name in ("/help",):
        lines = ["Available commands:"]
        for c in BUILTIN_COMMANDS:
            lines.append(f"  {c.usage or c.name:<20} {c.description}")
            if c.aliases:
                lines.append(f"  {'(aliases: ' + ', '.join(c.aliases) + ')':>20}")
        return CommandResult(text="\n".join(lines))
    if cmd_name in ("/tools",):
        if not ctx.tools:
            return CommandResult(text="No tools available.")
        lines = ["Available tools:"]
        for t in ctx.tools:
            name = t.get("name", "unknown")
            desc = t.get("description", "")
            lines.append(f"  {name:<25} {desc}")
        return CommandResult(text="\n".join(lines))
    if cmd_name in ("/config",):
        if ctx.config:
            return CommandResult(text=str(ctx.config))
        return CommandResult(text="No config loaded.")
    if cmd_name in ("/clear",):
        if ctx.clearScreen:
            ctx.clearScreen()
        return CommandResult(text="")
    if cmd_name in ("/save",):
        if cmd_arg and ctx.saveHistory:
            ctx.saveHistory(cmd_arg)
            return CommandResult(text=f"History saved to {cmd_arg}")
        return CommandResult(text="Usage: /save <path>")
    if cmd_name in ("/exit", "/quit"):
        return CommandResult(text="", kind="exit")
    return CommandResult(
        text=f"Unknown command: {cmd_name}. Type /help for available commands."
    )


# camelCase alias for backward compatibility
executeCommand = execute_command
executeSlashCommand = execute_command
