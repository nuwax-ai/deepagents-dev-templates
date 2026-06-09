"""MCP bridge tool — call tools through MCP servers."""

from __future__ import annotations

from typing import Any


def create_mcp_bridge_tool() -> dict[str, Any]:
    return {
        "name": "mcp_bridge",
        "description": "Call a tool exposed by a registered MCP server",
        "parameters": {
            "type": "object",
            "properties": {
                "server": {"type": "string", "description": "MCP server name"},
                "tool": {"type": "string", "description": "Tool name on that server"},
                "args": {"type": "object", "description": "Tool arguments"},
            },
            "required": ["server", "tool"],
        },
    }
