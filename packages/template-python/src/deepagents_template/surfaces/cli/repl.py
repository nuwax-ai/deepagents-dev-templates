"""REPL CLI — interactive session with a DeepAgent in the terminal."""

from __future__ import annotations

import sys
from typing import Any

from prompt_toolkit import PromptSession
from prompt_toolkit.history import InMemoryHistory
from rich.console import Console
from rich.panel import Panel

from deepagents_template.runtime.logger import logger
from deepagents_template.runtime.slash_commands.execution import executeSlashCommand
from deepagents_template.runtime.slash_commands.types import CommandContext


def start_repl(options: Any = None) -> None:
    """Start an interactive REPL session."""
    console = Console()
    console.print(
        Panel.fit("[bold cyan]DeepAgents Interactive REPL[/bold cyan]", border_style="cyan")
    )
    console.print("[dim]Type /help for commands. Ctrl+D or /exit to quit.[/dim]\n")

    log = logger.child("repl")
    history = InMemoryHistory()
    session = PromptSession(history=history)

    ctx = CommandContext(
        environment="cli",
        config=getattr(options, "config", None),
        workspaceRoot=getattr(options, "workspace_root", "") or "",
    )

    try:
        while True:
            try:
                text = session.prompt(">>> ")
            except (EOFError, KeyboardInterrupt):
                console.print("\n[dim]Goodbye![/dim]")
                break

            if not text.strip():
                continue

            if text.startswith("/"):
                result = executeSlashCommand(text, ctx)
                if result:
                    if result.kind == "exit":
                        break
                    if result.text:
                        console.print(result.text)
                continue

            console.print(f"[green]You:[/green] {text}")
            console.print("[yellow]Agent:[/yellow] (agent response placeholder)")
            console.print()
    except Exception as exc:
        log.exception("REPL error: %s", exc)
        sys.exit(1)
