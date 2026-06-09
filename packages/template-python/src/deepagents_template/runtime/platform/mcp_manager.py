"""MCP Manager — merges session/platform/default MCP server configs."""

from __future__ import annotations

from typing import Any


class MCPManager:
    def __init__(self) -> None:
        self._servers: dict[str, Any] = {}

    def register_server(self, name: str, config: dict[str, Any]) -> None:
        self._servers[name] = config

    def list_servers(self) -> list[str]:
        return list(self._servers.keys())

    def get_server(self, name: str) -> Any | None:
        return self._servers.get(name)

    def merge_servers(self, servers: dict[str, Any]) -> None:
        self._servers.update(servers)
