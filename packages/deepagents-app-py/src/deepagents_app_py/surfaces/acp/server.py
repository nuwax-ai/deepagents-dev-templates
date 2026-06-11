"""ACP server — bootstraps the official ``deepagents-acp`` server over stdio.

Mirrors the TS ``surfaces/acp/server.ts``: load config, build the agent factory
(``create_deep_agent`` per session), then start ``deepagents_acp``'s
``AgentServerACP`` over stdin/stdout via ``acp.run_agent``.

The official server already provides LangGraph streaming, HITL/permission
prompts, model switching, todo/plan updates and multimodal input. Gaps it does
*not* cover (slash commands, ACP MCP forwarding, configurable server
name/version, session list/close) are layered on by the ``session_lifecycle`` /
``slash_command_handler`` patch modules.
"""

from __future__ import annotations

import asyncio
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
    if debug:
        os.environ.setdefault("LOG_LEVEL", "debug")

    from deepagents_app_py.runtime.config.config_loader import loadConfig
    from deepagents_app_py.surfaces.acp.config_builder import (
        build_acp_agent_factory,
        load_session_config_from_env,
    )

    ws = workspace_root or os.getcwd()
    config = loadConfig({"configPath": config_path, "workspaceRoot": ws})
    session_config = load_session_config_from_env()
    if session_config:
        log.info("Loaded ACP session config from environment")

    # Agent factory — rebuilds a deepagents graph per session / model switch.
    factory = build_acp_agent_factory(config, ws, session_config=session_config)

    # Single-entry model list (the model selector advertised to the ACP client).
    provider = config.model.provider or "anthropic"
    model_name = config.model.name or "claude-sonnet-4-6"
    models = [{"value": f"{provider}:{model_name}", "name": model_name}]

    if not acp:
        log.info("ACP mode disabled — skipping server start")
        return

    from acp import run_agent as run_acp_agent

    from deepagents_app_py.surfaces.acp.session_lifecycle import DeepAgentsAppServer

    try:
        from deepagents_app_py.runtime.acp_server_internals import read_package_version

        pkg_version = read_package_version() or "0.0.0"
    except Exception:  # noqa: BLE001 — version metadata is best-effort
        pkg_version = "0.0.0"

    server = DeepAgentsAppServer(
        agent=factory,
        models=models,
        server_name=config.agent.name or "deepagents-app-py",
        server_version=getattr(config.agent, "version", None) or pkg_version,
    )

    log.info(
        "Starting ACP server",
        name=config.agent.name,
        model=model_name,
        workspaceRoot=ws,
    )
    asyncio.run(run_acp_agent(server))
