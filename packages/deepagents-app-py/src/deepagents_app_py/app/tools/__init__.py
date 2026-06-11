"""App tools — AI-editable LangChain tools.

Each module exports a LangChain ``@tool``. ``collect_tools()`` returns the list
passed to ``deepagents.create_deep_agent(tools=...)``.

Conversation history and checkpointing are handled by the deepagents / LangGraph
framework (message history + checkpointer), so they are not exposed as custom
tools here.
"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from deepagents_app_py.app.tools.agent_memory import agent_memory
from deepagents_app_py.app.tools.agent_variable import agent_variable
from deepagents_app_py.app.tools.http_request import http_request
from deepagents_app_py.app.tools.json_utils import json_utils
from deepagents_app_py.app.tools.mcp_bridge import mcp_bridge
from deepagents_app_py.app.tools.platform_api import platform_api
from deepagents_app_py.app.tools.runtime_info import runtime_info


def collect_tools() -> list[BaseTool]:
    """Return the custom app tools for ``create_deep_agent(tools=...)``."""
    return [
        http_request,
        runtime_info,
        json_utils,
        agent_variable,
        agent_memory,
        platform_api,
        mcp_bridge,
    ]


__all__ = [
    "agent_memory",
    "agent_variable",
    "collect_tools",
    "http_request",
    "json_utils",
    "mcp_bridge",
    "platform_api",
    "runtime_info",
]
