"""ACP Agent Config Builder — creates a pydantic-ai Agent for the ACP server."""

from __future__ import annotations

from typing import Any


def buildACPAgent(
    config: Any,
    workspace_root: str,
    session_config: Any | None = None,
) -> Any:
    """Build a pydantic-ai Agent for use with DeepAgentsServer.

    Uses the runtime's ``build_agent_config_parts()`` to assemble model,
    system prompt, tools, middleware, etc. — then constructs an Agent that
    supports ``.iter()`` for streaming.
    """
    from deepagents_app_py.runtime.helpers import build_agent_config_parts
    from deepagents_app_py.runtime.model import resolve_model

    # Assemble all agent config parts
    parts = build_agent_config_parts(config, session_config, workspace_root, [], None)

    # Extract model
    model = parts.get("model") or resolve_model(config)

    # Build the pydantic-ai Agent
    try:
        from pydantic_ai import Agent

        agent = Agent(
            model=model,
            system_prompt=parts.get("system_prompt", ""),
        )
        return agent
    except ImportError:
        # If pydantic-ai not available, return a simple callable
        log_msg = "pydantic-ai not available, returning simple agent"
        import logging
        logging.getLogger(__name__).warning(log_msg)
        return _SimpleAgent(parts)


class _SimpleAgent:
    """Fallback agent when pydantic-ai is not installed."""

    def __init__(self, parts: dict[str, Any]) -> None:
        self.parts = parts

    def __call__(self, prompt: str) -> str:
        return f"Agent received: {prompt}"
