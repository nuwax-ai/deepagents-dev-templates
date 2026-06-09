"""Runtime storage — session state management."""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any


def createSessionId(prefix: str = "sess") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def getRuntimeStorage(params: dict[str, Any]) -> dict[str, Any]:
    return {
        "workspaceRoot": params.get("workspaceRoot", os.getcwd()),
        "sessionId": params.get("sessionId", createSessionId()),
        "sessionDir": str(
            Path(params.get("workspaceRoot", os.getcwd()))
            / ".agent-sessions"
            / (params.get("sessionId", "unknown"))
        ),
        "messages": [],
    }


def ensureSessionState(storage: dict[str, Any], meta: dict[str, Any]) -> None:
    storage.setdefault("meta", {}).update(meta)


def appendRuntimeMessage(msg: dict[str, Any], storage: dict[str, Any]) -> None:
    storage.setdefault("messages", []).append(msg)


def closeSessionState(workspaceRoot: str, sessionId: str, meta: dict[str, Any]) -> bool:
    return True


def loadSessionState(
    workspaceRoot: str, sessionId: str, options: dict[str, Any] | None = None
) -> dict[str, Any]:
    return {"exists": False, "summary": {"messageCount": 0, "status": "new", "mode": "agent"}}


def listSessions(workspaceRoot: str) -> list[dict[str, Any]]:
    return []


def withRuntimeStorageContext(params: dict[str, Any], fn: Any) -> Any:
    return fn()
