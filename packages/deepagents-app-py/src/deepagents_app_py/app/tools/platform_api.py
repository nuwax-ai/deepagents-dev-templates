"""Platform API tool — calls the nuwax platform API via httpx."""

from __future__ import annotations

import os

import httpx
from langchain_core.tools import tool


@tool
def platform_api(endpoint: str, method: str = "GET", body: str | None = None) -> str:
    """Call the nuwax platform API.

    Uses the ``PLATFORM_API_URL`` (base URL) and ``PLATFORM_API_TOKEN`` (bearer)
    environment variables.

    Args:
        endpoint: API endpoint path, appended to ``PLATFORM_API_URL``.
        method: HTTP method — GET, POST, PUT, or DELETE.
        body: Optional JSON request body.
    """
    base = os.environ.get("PLATFORM_API_URL")
    if not base:
        return "PLATFORM_API_URL is not configured"
    token = os.environ.get("PLATFORM_API_TOKEN")
    url = base.rstrip("/") + "/" + endpoint.lstrip("/")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if body:
        headers["Content-Type"] = "application/json"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(method.upper(), url, headers=headers, content=body)
    except Exception as exc:  # noqa: BLE001 — surface the error to the model
        return f"platform_api failed: {exc}"
    return f"HTTP {resp.status_code}\n{resp.text[:4000]}"
