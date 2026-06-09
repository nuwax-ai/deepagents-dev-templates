"""Small string helpers used by the runtime."""

from __future__ import annotations

import re

_SLUG_RE = re.compile(r"[^a-zA-Z0-9]+")


def slugify(value: str, *, fallback: str = "agent") -> str:
    """Return a filesystem-safe slug derived from *value*."""
    raw = _SLUG_RE.sub("-", value).strip("-").lower()
    return raw or fallback


def truncate(value: str, *, limit: int = 4000, suffix: str = "…") -> str:
    """Truncate *value* to at most *limit* characters, appending *suffix*."""
    if len(value) <= limit:
        return value
    if limit <= len(suffix):
        return value[:limit]
    return value[: limit - len(suffix)] + suffix
