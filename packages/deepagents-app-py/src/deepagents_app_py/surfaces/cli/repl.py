"""REPL CLI — interactive session with a DeepAgent in the terminal."""

from __future__ import annotations

import sys
from typing import Any

from prompt_toolkit import PromptSession
from prompt_toolkit.history import InMemoryHistory
from rich.console import Console
from rich.panel import Panel

from deepagents_app_py.runtime.logger import logger
from deepagents_app_py.runtime.slash_commands.execution import executeSlashCommand
from deepagents_app_py.runtime.slash_commands.types import CommandContext


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

    # Build the deepagents graph once; a MemorySaver + fixed thread id keeps
    # multi-turn history across the REPL session.
    import os as _os

    from langgraph.checkpoint.memory import MemorySaver

    from deepagents_app_py.app.tools import collect_tools
    from deepagents_app_py.runtime.agent_config import build_graph
    from deepagents_app_py.runtime.config.config_loader import loadConfig

    ws = getattr(options, "workspace_root", None) or _os.getcwd()
    config = loadConfig({"workspaceRoot": ws, "configPath": getattr(options, "config_path", None)})
    graph = build_graph(config, None, ws, collect_tools(), checkpointer=MemorySaver())
    thread = {"configurable": {"thread_id": "repl"}}

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
            try:
                result = graph.invoke(
                    {"messages": [{"role": "user", "content": text}]}, config=thread
                )
                messages = result.get("messages", []) if isinstance(result, dict) else []
                reply = ""
                if messages:
                    content = messages[-1].content
                    reply = content if isinstance(content, str) else str(content)
                console.print(f"[yellow]Agent:[/yellow] {reply}")
            except Exception as exc:  # noqa: BLE001 — keep the REPL alive on errors
                console.print(f"[red]Error:[/red] {exc}")
            console.print()
    except Exception as exc:
        log.exception("REPL error: %s", exc)
        sys.exit(1)
