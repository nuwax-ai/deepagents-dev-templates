"""Agent config parts builder — composes the configuration passed to the agent.

Port of the TS ``src/runtime/agent-config.ts``. Instead of building a
``createDeepAgent`` payload (LangGraph), this assembles the keyword
arguments for a pydantic-ai ``Agent`` constructor: model, system prompt,
tools, model settings, skills, memory, subagents, permissions, and
middleware-compatible hooks.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai import ModelSettings

from deepagents_template.runtime.config.config_schema import ACPSessionConfig, AppConfig
from deepagents_template.runtime.helpers import (
    discover_memory_files as _helpers_discover_memory,
)
from deepagents_template.runtime.helpers import (
    discover_sub_agents as _helpers_discover_sub_agents,
)
from deepagents_template.runtime.helpers import (
    resolve_skills_paths,
    with_runtime_context_prompt,
)
from deepagents_template.runtime.logger import logger
from deepagents_template.runtime.middleware.compaction import create_compaction_middleware
from deepagents_template.runtime.middleware.cost_tracking import create_cost_tracking_middleware
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
from deepagents_template.runtime.model import resolve_model, resolve_summarizer_model
from deepagents_template.runtime.permissions import (
    build_interrupt_on,
    build_permissions,
    resolve_sandbox_policy,
    to_absolute_deny_glob,
)
from deepagents_template.runtime.prompt import resolve_system_prompt


def build_agent_config_parts(
    config: AppConfig,
    workspace_root: str,
    tools: list[dict[str, Any]],
    *,
    session_config: ACPSessionConfig | None = None,
    checkpointer: Any = None,
) -> dict[str, Any]:
    """Compose pydantic-ai Agent keyword arguments from ``AppConfig``.

    Returns a dict with keys that can be unpacked into ``Agent(**parts)``:

    * ``model`` — resolved pydantic-ai Model
    * ``system_prompt`` — final system prompt (with runtime context)
    * ``tools`` — list of pydantic-ai ``Tool`` objects
    * ``model_settings`` — ``ModelSettings`` (temperature, max_tokens, …)
    * ``result_type`` — optional structured result schema
    * ``before_model`` / ``after_model`` — hook lists for middleware
    * ``before_tool`` / ``after_tool`` — tool-lifecycle hooks
    """
    log = logger.child("agent-config")
    mw_config = config.middleware

    # ── Model ──────────────────────────────────────────────────────────
    model = resolve_model(config)

    # ── Model Settings ─────────────────────────────────────────────────
    model_settings_kw: dict[str, Any] = {}
    if config.model.settings.temperature is not None:
        model_settings_kw["temperature"] = config.model.settings.temperature
    if config.model.settings.max_tokens is not None:
        model_settings_kw["max_tokens"] = config.model.settings.max_tokens
    model_settings = ModelSettings(**model_settings_kw) if model_settings_kw else None

    # ── System Prompt ──────────────────────────────────────────────────
    system_prompt = with_runtime_context_prompt(
        resolve_system_prompt(config, session_config, workspace_root=workspace_root),
        workspace_root=workspace_root,
    )

    # ── Mode-based overrides ──────────────────────────────────────────
    mode = config.permissions.mode or "ask"
    interrupt_on = build_interrupt_on(config.permissions.interrupt_on or [])
    permissions = build_permissions(config, workspace_root)

    if mode == "plan":
        plan_preamble = (
            "## Planning Mode\n"
            "Before making any changes, you MUST:\n"
            "1. Present a clear plan of what you intend to do\n"
            "2. Wait for user approval\n"
            "3. Only then proceed with execution\n\n"
        )
        system_prompt = plan_preamble + system_prompt
    elif mode == "yolo":
        interrupt_on = {}

    # ── Middleware chain ───────────────────────────────────────────────
    middleware_hooks: dict[str, list[Any]] = {
        "before_model": [],
        "after_model": [],
        "before_tool": [],
        "after_tool": [],
    }

    # Harness lifecycle — always first
    middleware_hooks["before_model"].append(create_harness_lifecycle_middleware())

    # Stuck loop detection
    if mw_config.stuck_loop_detection.enabled:
        middleware_hooks["after_tool"].append(
            create_stuck_loop_middleware(
                threshold=mw_config.stuck_loop_detection.threshold,
                mode=mw_config.stuck_loop_detection.mode,
            )
        )

    # FS path resolver
    middleware_hooks["before_tool"].append(create_fs_path_resolver(workspace_root))

    # Periodic reminder
    if mw_config.periodic_reminder.enabled:
        middleware_hooks["before_model"].append(
            create_periodic_reminder_middleware(
                first_at=mw_config.periodic_reminder.first_at,
                every=mw_config.periodic_reminder.every,
            )
        )

    # Cost tracking
    if mw_config.cost_tracking.enabled:
        middleware_hooks["after_model"].append(
            create_cost_tracking_middleware(
                warn_at_tokens=mw_config.cost_tracking.warn_at_tokens,
            )
        )

    # Compaction (summarization)
    if config.compaction.enabled:
        middleware_hooks["before_model"].append(
            create_compaction_middleware(
                config=config.compaction,
                model=resolve_summarizer_model(config),
            )
        )

    # Eviction
    if config.eviction.enabled:
        middleware_hooks["after_tool"].append(
            create_eviction_middleware(config=config.eviction)
        )

    # Protected paths
    sandbox = resolve_sandbox_policy(config, workspace_root)
    if sandbox.denied_write_paths:
        denied_globs = [
            to_absolute_deny_glob(d, workspace_root)
            for d in sandbox.denied_write_paths
        ]
        middleware_hooks["before_tool"].append(
            create_protected_paths_middleware(denied_globs=denied_globs)
        )

    # ── Skills & Memory ───────────────────────────────────────────────
    skills_paths = resolve_skills_paths(config)
    memory_paths = _helpers_discover_memory(
        workspace_root, config.agent.include_workspace_instructions
    )
    sub_agents = _helpers_discover_sub_agents(config, workspace_root)

    # ── Assemble parts ────────────────────────────────────────────────
    parts: dict[str, Any] = {
        "model": model,
        "system_prompt": system_prompt,
        "tools": tools,
        "model_settings": model_settings,
        "middleware_hooks": middleware_hooks,
        "skills_paths": skills_paths,
        "memory_paths": memory_paths,
        "sub_agents": sub_agents,
        "permissions": permissions,
        "interrupt_on": interrupt_on,
        "checkpointer": checkpointer,
    }

    log.info(
        "Agent config parts built",
        extra={
            "name": config.agent.name,
            "model": config.model.name,
            "provider": config.model.provider,
            "mode": mode,
            "tools": len(tools),
            "skills": len(skills_paths),
            "sub_agents": len(sub_agents),
        },
    )

    return parts
