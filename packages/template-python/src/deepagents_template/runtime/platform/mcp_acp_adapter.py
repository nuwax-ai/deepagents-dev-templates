"""MCP-ACP adapter — bridges MCP server configs to ACP."""

from __future__ import annotations

from typing import Any


def forwardAcpMcpServers(mcpServers: Any, mcpManager: Any) -> None:
    """Forward ACP session mcpServers to the MCPManager."""
    if not mcpServers or not isinstance(mcpServers, dict):
        return
    for name, config in mcpServers.items():
        if isinstance(config, dict):
            mcpManager.register_server(name, config)
