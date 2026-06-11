"""ACP session-lifecycle patch.

Subclasses the official ``deepagents_acp.server.AgentServerACP`` to fill gaps
the 0.0.8 release leaves open. Mirrors the TS template's
``surfaces/acp/session-lifecycle.ts`` (which patches the same upstream server).

Currently fills:
  * **server name/version** — upstream ``initialize()`` returns no ``agent_info``,
    so ACP clients can't show the agent's identity; we advertise it here.

Deferred gaps (upstream's core protocol works without them):
  * slash-command interception (``/help``/``/clear``/``/status``) — override
    ``prompt()`` to intercept before the agent runs.
  * ACP ``mcp_servers`` forwarding — upstream ``new_session`` ignores the
    client's MCP servers; would require rebuilding the per-session graph with
    the forwarded MCP tools.
"""

from __future__ import annotations

from typing import Any

from deepagents_acp.server import AgentServerACP


class DeepAgentsAppServer(AgentServerACP):
    """``AgentServerACP`` that advertises the configured agent name/version."""

    def __init__(
        self,
        agent: Any,
        *,
        models: list[dict[str, str]] | None = None,
        server_name: str = "deepagents-app-py",
        server_version: str = "0.0.0",
    ) -> None:
        super().__init__(agent, models=models)
        self._server_name = server_name
        self._server_version = server_version

    async def initialize(
        self,
        protocol_version: int,
        client_capabilities: Any = None,
        client_info: Any = None,
        **kwargs: Any,
    ) -> Any:
        response = await super().initialize(
            protocol_version, client_capabilities, client_info, **kwargs
        )
        # Upstream leaves agent_info unset — advertise our identity so the ACP
        # client can display the agent name/version.
        try:
            from acp.schema import Implementation

            response.agent_info = Implementation(
                name=self._server_name, version=self._server_version
            )
        except Exception:  # noqa: BLE001 — name/version is best-effort metadata
            pass
        return response
