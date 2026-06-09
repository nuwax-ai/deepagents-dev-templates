"""Permission policy resolution.

Port of ``src/runtime/permissions.ts``. Resolves the three permission modes
(``ask`` / ``yolo`` / ``plan``) into concrete allow/deny globs and HITL
interrupt-on maps.
"""

from __future__ import annotations

import fnmatch
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from deepagents_template.runtime.config.config_schema import (
    AppConfig,
    PermissionsConfig,
)


@dataclass
class SandboxPolicy:
    """Resolved sandbox policy — read/write allow/deny globs plus protected."""

    allowed_read_paths: list[str] = field(default_factory=list)
    allowed_write_paths: list[str] = field(default_factory=list)
    denied_read_paths: list[str] = field(default_factory=list)
    denied_write_paths: list[str] = field(default_factory=list)
    profile: str = "workspace"  # "open" | "workspace"


def resolve_sandbox_policy(
    config: AppConfig, workspace_root: Path | str | None = None
) -> SandboxPolicy:
    """Resolve a :class:`SandboxPolicy` for *config* against *workspace_root*."""
    permissions: PermissionsConfig = config.permissions

    allowed_read = list(permissions.allowed_paths or []) or ["/**"]
    allowed_write = list(permissions.allowed_paths or []) or ["/**"]
    denied_read = [str(p) for p in (permissions.denied_paths or [])]
    denied_write = [str(p) for p in (permissions.denied_paths or [])]

    profile = "open" if permissions.mode == "yolo" and not denied_write else "workspace"
    return SandboxPolicy(
        allowed_read_paths=allowed_read,
        allowed_write_paths=allowed_write,
        denied_read_paths=denied_read,
        denied_write_paths=denied_write,
        profile=profile,
    )


def to_absolute_deny_glob(denied: str, workspace_root: Path | str) -> str:
    """Return an absolute, glob-style deny entry — mirrors TS helper."""
    root = Path(workspace_root).expanduser().resolve()
    if denied.startswith("/"):
        return str(root / denied.lstrip("/")).rstrip("/") + "/**"
    return str((root / denied).resolve()) + "/**"


def build_permissions(
    config: AppConfig, workspace_root: Path | str | None = None
) -> list[dict[str, Any]]:
    """Translate :class:`PermissionsConfig` into deepagents-style permission dicts."""
    sandbox = resolve_sandbox_policy(config, workspace_root)
    root = Path(workspace_root).expanduser().resolve() if workspace_root else Path.cwd()
    rules: list[dict[str, Any]] = []

    if sandbox.allowed_write_paths:
        rules.append(
            {
                "operations": ["read", "write"],
                "paths": [str(root / p.lstrip("/")) for p in sandbox.allowed_write_paths],
                "mode": "allow",
            }
        )
    for denied in sandbox.denied_write_paths:
        rules.append(
            {
                "operations": ["write"],
                "paths": [to_absolute_deny_glob(denied, root)],
                "mode": "deny",
            }
        )
    return rules


def build_interrupt_on(tools: Iterable[str]) -> dict[str, bool]:
    """Build the ``interrupt_on`` dict consumed by deepagents/pydantic-ai."""
    return {tool: True for tool in tools}


def is_path_allowed(path: Path, globs: Iterable[str], workspace_root: Path) -> bool:
    """Return ``True`` if *path* matches any of *globs* (relative to *workspace_root*)."""
    target = path if path.is_absolute() else (workspace_root / path).resolve()
    for pattern in globs:
        absolute = pattern if pattern.startswith("/") else str(workspace_root / pattern)
        if fnmatch.fnmatch(str(target), absolute):
            return True
    return False
