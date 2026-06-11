"""HTTP request tool — make an HTTP request via httpx."""

from __future__ import annotations

import httpx
from langchain_core.tools import tool

_MAX = 4000


@tool
def http_request(url: str, method: str = "GET", body: str | None = None) -> str:
    """Make an HTTP request to a URL and return the status code and (truncated) body.

    Args:
        url: The URL to request.
        method: HTTP method — GET, POST, PUT, or DELETE.
        body: Optional request body for POST/PUT.
    """
    try:
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            resp = client.request(method.upper(), url, content=body)
    except Exception as exc:  # noqa: BLE001 — surface the error to the model
        return f"Request failed: {exc}"

    text = resp.text
    if len(text) > _MAX:
        text = text[:_MAX] + f"\n... [truncated {len(resp.text) - _MAX} chars]"
    return f"HTTP {resp.status_code}\n{text}"
