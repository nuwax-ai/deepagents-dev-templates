"""MCP bridge tool — guidance for invoking MCP server tools.

MCP servers configured via the ACP session or ``mcp`` config are exposed to the
agent as *native* tools (deepagents/LangChain register them directly), so the
model should call those tools by name. This bridge is a thin explicit fallback.
"""

from __future__ import annotations

from langchain_core.tools import tool


@tool
def mcp_bridge(server: str, tool: str, args: dict | None = None) -> str:  # noqa: ARG001
    """Describe how to call a tool exposed by a registered MCP server.

    Args:
        server: MCP server name.
        tool: Tool name on that server.
        args: Tool arguments.
    """
    return (
        f"Tools from MCP server '{server}' are registered as native agent tools when the "
        f"server is configured. Call '{tool}' directly by its tool name rather than through "
        "this bridge."
    )
