"""Session management for ACP server.

Provides ``SessionContext`` (per-session data) and ``SessionManager``
(in-memory session tracker).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class SessionContext:
    """Per-session state tracked by the ACP server."""

    session_id: str
    cwd: str = "."
    model: str | None = None
    mode: str = "agent"
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    message_count: int = 0
    history: list[Any] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)
    # Per-session state — independent across concurrent sessions
    cancelled: bool = False
    cached_agent: Any | None = None
    cached_agent_model: str | None = None

    def touch(self) -> None:
        """Update last activity timestamp."""
        self.last_activity_at = datetime.now(timezone.utc)

    def invalidate_agent(self) -> None:
        """Drop the cached agent (call when session state changes)."""
        self.cached_agent = None
        self.cached_agent_model = None


class SessionManager:
    """In-memory session tracker.

    Tracks active sessions with ``SessionContext`` objects, providing
    create/read/update/delete operations.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, SessionContext] = {}

    def track(self, ctx: SessionContext) -> None:
        """Register a new session."""
        self._sessions[ctx.session_id] = ctx

    def touch(self, session_id: str) -> None:
        """Update last activity timestamp for a session."""
        ctx = self._sessions.get(session_id)
        if ctx is not None:
            ctx.touch()

    def close(self, session_id: str) -> SessionContext | None:
        """Remove and return a session. Returns None if not found."""
        return self._sessions.pop(session_id, None)

    def get(self, session_id: str) -> SessionContext | None:
        """Look up a session by ID."""
        return self._sessions.get(session_id)

    def has(self, session_id: str) -> bool:
        """Check if a session exists."""
        return session_id in self._sessions

    def list(self) -> list[SessionContext]:
        """Return all active sessions."""
        return list(self._sessions.values())

    def count(self) -> int:
        """Return the number of active sessions."""
        return len(self._sessions)
