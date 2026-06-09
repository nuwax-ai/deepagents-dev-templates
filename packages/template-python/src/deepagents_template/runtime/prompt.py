"""System prompt assembly.

The Python template keeps the prompt logic in two layers:

* :func:`resolve_system_prompt` — picks CLI / REPL / ACP prompt sources.
* :func:`with_runtime_context_prompt` — appends runtime context (cwd, etc.).

The TS template additionally composes fragments from ``prompts/`` and
``prompts/styles/``; this file re-exports the resolver and provides a thin
``compose_prompt`` helper that callers can use to glue in user content.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from deepagents_template.runtime.config.config_schema import AppConfig


def compose_prompt(parts: list[str]) -> str:
    """Concatenate prompt fragments, separating them with a blank line."""
    return "\n\n".join(p.strip() for p in parts if p and p.strip())


def load_prompt_file(path: Path | str) -> str:
    """Read a prompt markdown file from disk."""
    return Path(path).read_text(encoding="utf-8")


def resolve_system_prompt(
    config: AppConfig,
    session_config: Any | None,
    workspace_root: Path | str,
) -> str:
    """Return the effective system prompt for a session.

    If the ACP session supplies a system prompt via metadata, it wins.
    Otherwise we fall back to the agent's configured style.
    """
    from deepagents_template.runtime.helpers import (
        resolve_cli_system_prompt,
    )

    if session_config is not None and getattr(session_config, "system_prompt", None):
        return str(session_config.system_prompt)
    return resolve_cli_system_prompt(config, workspace_root)


def with_runtime_context_prompt(prompt: str, workspace_root: Path | str) -> str:
    """Append runtime context (workspace root, env hints) to *prompt*."""
    from deepagents_template.runtime.helpers import with_runtime_context_prompt as _with

    return _with(prompt, workspace_root)
