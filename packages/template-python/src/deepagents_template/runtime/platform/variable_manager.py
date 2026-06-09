"""Variable Manager — manages agent variables."""

from __future__ import annotations

from typing import Any


class VariableManager:
    def __init__(self) -> None:
        self._variables: dict[str, Any] = {}

    def get(self, key: str) -> Any | None:
        return self._variables.get(key)

    def set(self, key: str, value: Any) -> None:
        self._variables[key] = value

    def list(self) -> dict[str, Any]:
        return dict(self._variables)

    def delete(self, key: str) -> bool:
        return self._variables.pop(key, None) is not None
