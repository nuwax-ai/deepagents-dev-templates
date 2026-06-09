"""ACP Session Manager — tracks active ACP sessions."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}

    def track(self, sessionId: str, mode: str) -> None:
        self._sessions[sessionId] = {
            "sessionId": sessionId,
            "createdAt": datetime.now(UTC).isoformat(),
            "lastActivityAt": datetime.now(UTC).isoformat(),
            "mode": mode,
            "messageCount": 0,
        }

    def touch(self, sessionId: str) -> None:
        info = self._sessions.get(sessionId)
        if info:
            info["lastActivityAt"] = datetime.now(UTC).isoformat()
            info["messageCount"] = info.get("messageCount", 0) + 1

    def close(self, sessionId: str) -> dict[str, Any] | None:
        return self._sessions.pop(sessionId, None)

    def list(self) -> list[dict[str, Any]]:
        return list(self._sessions.values())

    def has(self, sessionId: str) -> bool:
        return sessionId in self._sessions

    @property
    def count(self) -> int:
        return len(self._sessions)
