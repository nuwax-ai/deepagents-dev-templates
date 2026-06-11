"""Agent variable tool — read/write agent variables (``AGENT_VAR_*`` env vars)."""

from __future__ import annotations

import os

from langchain_core.tools import tool

_PREFIX = "AGENT_VAR_"


@tool
def agent_variable(operation: str, key: str | None = None, value: str | None = None) -> str:
    """Read or write agent variables, stored as ``AGENT_VAR_<KEY>`` environment variables.

    Args:
        operation: One of ``get``, ``set``, ``list``, ``delete``.
        key: Variable name (required for get/set/delete).
        value: Value to store (required for ``set``).
    """
    if operation == "list":
        items = {k[len(_PREFIX):]: v for k, v in os.environ.items() if k.startswith(_PREFIX)}
        return "\n".join(f"{k}={v}" for k, v in sorted(items.items())) or "(no agent variables set)"

    if not key:
        return "key is required for get/set/delete"
    env_key = _PREFIX + key

    if operation == "get":
        return os.environ.get(env_key, f"(unset: {key})")
    if operation == "set":
        os.environ[env_key] = value or ""
        return f"set {key}"
    if operation == "delete":
        os.environ.pop(env_key, None)
        return f"deleted {key}"
    return f"unknown operation: {operation!r} (use get|set|list|delete)"
