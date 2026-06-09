"""Approvals storage — tracks pending/approved/denied HITL approvals."""

from __future__ import annotations

from typing import Any


class ApprovalStore:
    def __init__(self) -> None:
        self._approvals: dict[str, Any] = {}

    def pend(self, key: str, action: str, details: Any) -> None:
        self._approvals[key] = {"action": action, "details": details, "status": "pending"}

    def approve(self, key: str) -> bool:
        if key in self._approvals and self._approvals[key]["status"] == "pending":
            self._approvals[key]["status"] = "approved"
            return True
        return False

    def deny(self, key: str) -> bool:
        if key in self._approvals and self._approvals[key]["status"] == "pending":
            self._approvals[key]["status"] = "denied"
            return True
        return False
