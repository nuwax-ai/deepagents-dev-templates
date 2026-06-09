"""Platform API client — communicates with the nuwax platform API."""

from __future__ import annotations

from typing import Any

import httpx


class PlatformClient:
    def __init__(
        self, apiBaseUrl: str = "https://api.nuwax.com", agentId: str = "", spaceId: str = ""
    ) -> None:
        self.apiBaseUrl = apiBaseUrl.rstrip("/")
        self.agentId = agentId
        self.spaceId = spaceId
        self._client = httpx.AsyncClient(base_url=self.apiBaseUrl, timeout=30.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = path.format(agentId=self.agentId, spaceId=self.spaceId)
        resp = await self._client.request(method, url, **kwargs)
        resp.raise_for_status()
        return resp.json()
