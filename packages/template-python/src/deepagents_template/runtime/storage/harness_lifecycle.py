"""Harness lifecycle tracking — turn start/complete/fail."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def beginHarnessTurn(prompt: str | None, storage: Any) -> None:
    if storage:
        storage["turn"] = {"started": datetime.now(UTC).isoformat(), "prompt": prompt}


def completeHarnessTurn(storage: Any) -> None:
    if storage and "turn" in storage:
        storage["turn"]["completed"] = datetime.now(UTC).isoformat()


def failHarnessTurn(err: Any, storage: Any) -> None:
    if storage and "turn" in storage:
        storage["turn"]["failed"] = datetime.now(UTC).isoformat()
        storage["turn"]["error"] = str(err)


def readHarnessLifecycle(storage: Any) -> dict[str, Any]:
    return storage.get("turn", {}) if storage else {}
