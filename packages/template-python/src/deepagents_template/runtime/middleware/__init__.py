"""Middleware layer — protects/directs/wraps agent behavior."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from deepagents_template.runtime.middleware.compaction import create_compaction_middleware
from deepagents_template.runtime.middleware.cost_tracking import (
    create_cost_tracking_middleware,
)
from deepagents_template.runtime.middleware.eviction import create_eviction_middleware
from deepagents_template.runtime.middleware.fs_path_resolver import create_fs_path_resolver
from deepagents_template.runtime.middleware.harness_lifecycle import (
    create_harness_lifecycle_middleware,
)
from deepagents_template.runtime.middleware.periodic_reminder import (
    create_periodic_reminder_middleware,
)
from deepagents_template.runtime.middleware.protected_paths import (
    create_protected_paths_middleware,
)
from deepagents_template.runtime.middleware.stuck_loop import create_stuck_loop_middleware


def build_middleware(
    config: Any, workspace_root: str | Path, backend: Any
) -> dict[str, list[Any]]:
    """Build and return the middleware hook dict for the agent."""
    hooks: dict[str, list[Any]] = {
        "before_model": [],
        "after_model": [],
        "before_tool": [],
        "after_tool": [],
    }
    if config is None:
        return hooks

    mw = config.middleware
    root = str(workspace_root)

    hooks["before_model"].append(create_harness_lifecycle_middleware())
    hooks["before_tool"].append(create_fs_path_resolver(root))

    if mw.stuck_loop_detection.enabled:
        hooks["after_tool"].append(
            create_stuck_loop_middleware(
                threshold=mw.stuck_loop_detection.threshold,
                mode=mw.stuck_loop_detection.mode,
            )
        )
    if mw.periodic_reminder.enabled:
        hooks["before_model"].append(
            create_periodic_reminder_middleware(
                first_at=mw.periodic_reminder.first_at,
                every=mw.periodic_reminder.every,
            )
        )
    if mw.cost_tracking.enabled:
        hooks["after_model"].append(
            create_cost_tracking_middleware(
                warn_at_tokens=mw.cost_tracking.warn_at_tokens,
            )
        )
    if config.compaction.enabled:
        from deepagents_template.runtime.model import resolve_summarizer_model

        hooks["before_model"].append(
            create_compaction_middleware(
                config=config.compaction,
                model=resolve_summarizer_model(config),
            )
        )
    if config.eviction.enabled:
        hooks["after_tool"].append(create_eviction_middleware(config=config.eviction))

    from deepagents_template.runtime.permissions import (
        resolve_sandbox_policy,
        to_absolute_deny_glob,
    )

    sandbox = resolve_sandbox_policy(config, root)
    if sandbox.denied_write_paths:
        denied_globs = [
            to_absolute_deny_glob(d, root) for d in sandbox.denied_write_paths
        ]
        hooks["before_tool"].append(
            create_protected_paths_middleware(denied_globs=denied_globs)
        )

    return hooks


__all__ = [
    "build_middleware",
    "create_compaction_middleware",
    "create_cost_tracking_middleware",
    "create_eviction_middleware",
    "create_fs_path_resolver",
    "create_harness_lifecycle_middleware",
    "create_periodic_reminder_middleware",
    "create_protected_paths_middleware",
    "create_stuck_loop_middleware",
]
