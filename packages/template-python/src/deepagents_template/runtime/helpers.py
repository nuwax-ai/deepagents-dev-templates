"""Shared helpers used by the agent factory, surfaces and CLI.

A small subset of the TypeScript template's ``runtime/helpers.ts`` is
re-implemented here for the most common operations: model-string
resolution, system-prompt assembly, and interrupt-on map construction.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from deepagents_template.runtime.config.config_schema import AppConfig
from deepagents_template.runtime.permissions import build_interrupt_on, build_permissions


def resolve_model_string(config: AppConfig) -> str:
    """Return the ``"provider:model-name"`` string consumed by pydantic-ai."""
    return f"{config.model.provider}:{config.model.name}"


def resolve_cli_system_prompt(config: AppConfig, workspace_root: Path | str) -> str:
    """Return the system prompt used by the CLI / REPL surface.

    Falls back to the template's base prompt when no custom one is set.
    """
    if config.agent.output_style:
        return (
            f"You are {config.agent.name}, a scenario-specific AI agent.\n\n"
            f"Output style: {config.agent.output_style}.\n"
            f"Workspace: {workspace_root}.\n"
        )
    return (
        f"You are {config.agent.name}, a scenario-specific AI agent.\n"
        f"Workspace: {workspace_root}.\n"
    )


def resolve_system_prompt(
    config: AppConfig,
    session_config: Any | None,
    workspace_root: Path | str,
) -> str:
    """Return the effective system prompt for a given session."""
    if session_config is not None and getattr(session_config, "system_prompt", None):
        return str(session_config.system_prompt)
    return resolve_cli_system_prompt(config, workspace_root)


def with_runtime_context_prompt(prompt: str, workspace_root: Path | str) -> str:
    """Append runtime context (workspace root, env hints) to *prompt*."""
    extra = (
        f"\n\n## Runtime Context\n"
        f"- Workspace root: {workspace_root}\n"
        f"- Python: {os.environ.get('PYTHON_VERSION', '>=3.11')}\n"
    )
    return prompt.rstrip() + extra


def discover_memory_files(workspace_root: Path | str, include_workspace: bool) -> list[str]:
    """Return the list of memory file paths to load."""
    root = Path(workspace_root).expanduser().resolve()
    files: list[str] = []
    memory_dir = root / ".agent-memory"
    if memory_dir.exists():
        for path in sorted(memory_dir.rglob("*.md")):
            files.append(str(path))
    if include_workspace:
        for name in ("AGENTS.md", "CLAUDE.md", "README.md"):
            candidate = root / name
            if candidate.exists() and candidate.is_file():
                files.append(str(candidate))
    return files


def resolve_skills_paths(config: AppConfig) -> list[str]:
    """Return the absolute paths of the configured skill directories."""
    base = Path.cwd()
    return [str((base / p).resolve()) for p in (config.skills.directories or [])]


def discover_sub_agents(config: AppConfig, workspace_root: Path | str) -> list[dict[str, Any]]:
    """Return sub-agent specs discovered under the configured ``agentsDirectories``."""
    from deepagents_template.runtime.discovery import discover_sub_agents as _discover

    base = Path(workspace_root).expanduser().resolve()
    found: list[dict[str, Any]] = []
    for entry in (config.agents_directories or []):
        found.extend(
            {
                "name": sub.name,
                "description": sub.description,
                "path": str(sub.path),
                **sub.config,
            }
            for sub in _discover(base, agents_dir=entry.lstrip("./").lstrip("/"))
        )
    return found


def build_agent_config_parts(
    config: AppConfig,
    session_config: Any | None,
    workspace_root: Path | str,
    tools: list[Any],
    backend: Any,
    *,
    checkpointer: Any | bool = True,
) -> dict[str, Any]:
    """Compose the config dict passed to pydantic-ai's ``Agent`` constructor."""
    from deepagents_template.runtime.middleware import build_middleware

    system_prompt = with_runtime_context_prompt(
        resolve_system_prompt(config, session_config, workspace_root),
        workspace_root,
    )
    if config.permissions.mode == "plan":
        system_prompt = (
            "## Planning Mode\n"
            "Before making any changes, you MUST:\n"
            "1. Present a clear plan of what you intend to do\n"
            "2. Wait for user approval\n"
            "3. Only then proceed with execution\n\n" + system_prompt
        )

    return {
        "model": resolve_model_string(config),
        "instructions": system_prompt,
        "tools": tools,
        "deps": None,
        "middleware": build_middleware(config, str(workspace_root), backend),
        "permissions": build_permissions(config, workspace_root),
        "interrupt_on": build_interrupt_on(list(config.permissions.interrupt_on or [])),
        "checkpointer": checkpointer,
    }


@dataclass
class RuntimeContext:
    """Bundle of resources handed to the agent factory."""

    config: AppConfig
    workspace_root: Path
    platform_client: Any | None
    mcp_manager: Any
    variable_manager: Any
    tools: list[Any]


def build_permissions_alias(config: AppConfig, workspace_root: Path | str) -> list[dict[str, Any]]:
    return build_permissions(config, workspace_root)


def build_interrupt_on_alias(config: AppConfig) -> dict[str, bool]:
    return build_interrupt_on(list(config.permissions.interrupt_on or []))
