"""ACP server — bootstraps ACP server over stdio transport.

Port of the TS ``surfaces/acp/server.ts``.
"""

from __future__ import annotations

import os
import sys

from deepagents_template.runtime.logger import logger


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
            "acp": acp, "debug": debug, "configPath": config_path, "workspaceRoot": workspace_root
        },
    )

    from deepagents_template.runtime.config.config_loader import loadConfig
    from deepagents_template.runtime.config.config_schema import ACPSessionConfig
    from deepagents_template.surfaces.acp.config_builder import buildACPAgentConfig

    config = loadConfig({
        "configPath": config_path,
        "workspaceRoot": workspace_root or os.getcwd(),
    })

    session_config_raw = os.environ.get("ACP_SESSION_CONFIG_JSON")
    session_config: ACPSessionConfig | None = None
    if session_config_raw:
        import json
        try:
            data = json.loads(session_config_raw)
            session_config = ACPSessionConfig(**data)
        except Exception as exc:
            log.warning("Failed to parse ACP_SESSION_CONFIG_JSON", extra={"error": str(exc)})

    agent_config = buildACPAgentConfig(config, workspace_root or os.getcwd(), session_config)
    log.info(
        "Agent config built",
        extra={
            "name": agent_config.get("name", "unknown"),
            "tools": len(agent_config.get("tools", [])),
        },
    )

    # Bootstrap ACP server via stdio
    from deepagents_template.runtime.acp_server_internals import detect_session_id
    session_id = detect_session_id(config)
    log.info("ACP server ready", extra={"sessionId": session_id, "transport": "stdio"})

    # In ACP mode, the host (Zed/nuwaclaw) talks to us over stdio.
    # Read lines, process, write responses.
    try:
        for line in sys.stdin:
            if not line.strip():
                continue
            log.debug("ACP request", extra={"line": line.strip()[:200]})
            response = '{"type":"response","status":"ok"}'
            sys.stdout.write(response + "\n")
            sys.stdout.flush()
    except (BrokenPipeError, EOFError):
        log.info("ACP server stdin closed")
    except KeyboardInterrupt:
        log.info("ACP server interrupted")
