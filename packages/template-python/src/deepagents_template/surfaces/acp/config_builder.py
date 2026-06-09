"""ACP Agent Config Builder — builds DeepAgentConfig for the ACP server."""

from __future__ import annotations

from typing import Any


def buildACPAgentConfig(
    config: Any,
    workspaceRoot: str,
    sessionConfig: Any | None = None,
) -> dict[str, Any]:
    """Build a DeepAgentConfig-like dict for the ACP server."""
    from deepagents_template.runtime.helpers import build_agent_config_parts

    agent_config = {
        "name": config.agent.name if hasattr(config, "agent") else "deepagents-template",
        "description": config.agent.description if hasattr(config, "agent") else "",
    }
    parts = build_agent_config_parts(config, sessionConfig, workspaceRoot, [], None)
    agent_config.update(parts)
    agent_config["interruptOn"] = {}
    return agent_config
