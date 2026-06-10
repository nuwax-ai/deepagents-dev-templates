"""ACP Agent Config Builder — creates a pydantic-ai Agent for the ACP server."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def buildACPAgent(
    config: Any,
    workspace_root: str,
    session_config: Any | None = None,
) -> Any:
    """Build a pydantic-ai Agent for use with DeepAgentsServer.

    Uses the runtime's ``build_agent_config_parts()`` to assemble model,
    system prompt, tools, middleware, etc. — then constructs an Agent that
    supports ``.iter()`` for streaming.

    Reads the returned dict with the actual key names produced by
    ``build_agent_config_parts()``: ``"instructions"`` (not
    ``"system_prompt"``).
    """
    from deepagents_app_py.runtime.helpers import build_agent_config_parts
    from deepagents_app_py.runtime.model import resolve_model

    # Assemble all agent config parts
    parts = build_agent_config_parts(
        config=config,
        session_config=session_config,
        workspace_root=workspace_root,
        tools=[],
        backend=None,
        checkpointer=True,
    )

    # Extract model — parts["model"] is a string like "anthropic:claude-sonnet-4-6";
    # pydantic-ai expects a Model instance.
    model = resolve_model(config)

    # Build the pydantic-ai Agent
    try:
        from pydantic_ai import Agent

        return Agent(
            model=model,
            # helpers.py returns key "instructions" — use that, fall back to
            # "system_prompt" in case a future refactor renames it.
            instructions=parts.get("instructions", parts.get("system_prompt", "")),
            deps_type=Any,
        )
    except ImportError:
        # If pydantic-ai not available, return a simple callable
        logger.warning("pydantic-ai not available, returning simple agent")
        return _SimpleAgent(parts)


class _SimpleAgent:
    """Fallback agent when pydantic-ai is not installed."""

    def __init__(self, parts: dict[str, Any]) -> None:
        self.parts = parts

    def __call__(self, prompt: str) -> str:
        return f"Agent received: {prompt}"
