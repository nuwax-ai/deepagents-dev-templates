"""ACP server — bootstraps ACP server over stdio transport.

Uses ``deepagents-acp-py`` to provide a full ACP protocol implementation,
replacing the previous hand-rolled stdio stub.
"""

from __future__ import annotations

import os

from deepagents_app_py.runtime.logger import logger


def bootstrap(
    *,
    acp: bool = True,
    debug: bool = False,
    config_path: str | None = None,
    workspace_root: str | None = None,
) -> None:
    """Bootstrap and start the ACP server over stdin/stdout."""
    log = logger.child("acp-server")
    log.info(
        "Starting ACP server",
        extra={
            "acp": acp,
            "debug": debug,
            "configPath": config_path,
            "workspaceRoot": workspace_root,
        },
    )

    from deepagents_app_py.runtime.config.config_loader import loadConfig
    from deepagents_app_py.runtime.acp_server_internals import read_package_version

    # Load config
    config = loadConfig({
        "configPath": config_path,
        "workspaceRoot": workspace_root or os.getcwd(),
    })

    # Build agent factory — creates a pydantic-ai Agent per session
    def build_agent(ctx):  # type: ignore[no-untyped-def]
        from deepagents_app_py.surfaces.acp.config_builder import buildACPAgent
        return buildACPAgent(config, ctx.cwd)

    # Build model list from config
    models = []
    provider = config.model.provider or "anthropic"
    model_name = config.model.name or "claude-sonnet-4-6"
    models.append({
        "value": f"{provider}:{model_name}",
        "name": model_name,
    })

    # Create and run the ACP server
    from deepagents_acp_py import DeepAgentsServer, run_agent

    pkg_version = read_package_version() or "0.0.0"

    server = DeepAgentsServer(
        agent=build_agent,
        name=config.agent.name or "deepagents-app-py",
        version=pkg_version,
        models=models,
        workspace_root=workspace_root or os.getcwd(),
        debug=debug,
    )

    log.info(
        "ACP server configured",
        extra={
            "name": config.agent.name,
            "model": model_name,
            "version": pkg_version,
        },
    )

    run_agent(server, debug=debug)
