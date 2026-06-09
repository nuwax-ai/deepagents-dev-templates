"""Internal helpers for the ACP server surface.

This module is a small Python port of the ``acp-server-internals.ts`` module
and is used to read package metadata, build version banners, and compute
session IDs. Kept separate from ``surfaces/acp/server.py`` so it can be
unit-tested without the ACP transport in scope.
"""

from __future__ import annotations

import json
import re
import socket
from typing import Any

from deepagents_template.runtime.config.config_schema import AppConfig

_PKG_VERSION_CACHE: str | None = None


def read_package_version() -> str | None:
    """Return the running package's version, cached at module load."""
    global _PKG_VERSION_CACHE
    if _PKG_VERSION_CACHE is not None:
        return _PKG_VERSION_CACHE
    try:
        from importlib.metadata import version

        _PKG_VERSION_CACHE = version("deepagents-dev-templates-python")
    except Exception:
        _PKG_VERSION_CACHE = None
    return _PKG_VERSION_CACHE


def detect_session_id(config: AppConfig, explicit: str | None = None) -> str:
    """Return a stable session ID for this run."""
    if explicit:
        return explicit
    host = socket.gethostname()
    return f"{host}-{config.agent.name}"


_SAFE_ID = re.compile(r"[^a-zA-Z0-9_-]+")


def safe_id(value: str) -> str:
    """Sanitize *value* for use as a session / thread identifier."""
    cleaned = _SAFE_ID.sub("-", value).strip("-")
    return cleaned or "session"


def load_session_config_from_env() -> dict[str, Any] | None:
    """Read ``ACP_SESSION_CONFIG_JSON`` (mirrors the TS helper)."""
    import os

    raw = os.environ.get("ACP_SESSION_CONFIG_JSON")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None
