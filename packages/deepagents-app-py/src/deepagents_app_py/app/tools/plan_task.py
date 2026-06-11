"""Plan task tool — structured task list for the current agent session."""

from __future__ import annotations

import json
import os
import random
import re
import string
import time
from pathlib import Path
from typing import Literal

from langchain_core.tools import tool


# ---------------------------------------------------------------------------
# Path helpers — mirror checkpoint.py pattern
# ---------------------------------------------------------------------------

def _working_dir() -> Path:
    return Path(os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd()))


def _session_id() -> str:
    return (
        os.environ.get("DEEPAGENTS_SESSION_ID")
        or os.environ.get("ACP_SESSION_ID")
        or "default"
    )


def _tasks_path() -> Path:
    return _working_dir() / ".agent-sessions" / _session_id() / "tasks.json"


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    p = _tasks_path()
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(tasks: list[dict]) -> None:
    p = _tasks_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(tasks, indent=2) + "\n", encoding="utf-8")


def _gen_id() -> str:
    ts = hex(int(time.time() * 1000))[2:]
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=3))
    return f"t-{ts}-{rand}"


_STATUS_ICON = {"pending": "○", "in_progress": "◑", "completed": "●", "blocked": "✗"}


def _render(tasks: list[dict]) -> str:
    if not tasks:
        return "No tasks. Use add to create one."
    lines = []
    for t in tasks:
        icon = _STATUS_ICON.get(t.get("status", "pending"), "?")
        notes = f" — {t['notes']}" if t.get("notes") else ""
        lines.append(f"{icon} [{t['id']}] {t['step']}{notes}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Tool
# ---------------------------------------------------------------------------

@tool
def plan_task(
    operation: Literal["list", "add", "update", "clear"],
    step: str | None = None,
    task_id: str | None = None,
    status: Literal["pending", "in_progress", "completed", "blocked"] | None = None,
    notes: str | None = None,
) -> str:
    """Manage a structured task list for the current agent session.

    Use this to break down a goal into steps and track progress autonomously.
    Operations:
    - list  : Show all tasks with status (○ pending, ◑ in_progress, ● completed, ✗ blocked)
    - add   : Add a new step (requires step)
    - update: Change a task's status or notes (requires task_id)
    - clear : Remove all tasks

    Tasks persist across turns inside .agent-sessions/<session_id>/tasks.json.

    Args:
        operation: Operation to perform.
        step: Task description — required for add.
        task_id: Task ID from list output — required for update.
        status: New status (for update).
        notes: Notes to attach or update on the task.
    """
    tasks = _load()

    if operation == "list":
        return _render(tasks)

    if operation == "add":
        if not step:
            return "Error: step is required for add"
        task: dict = {"id": _gen_id(), "step": step, "status": "pending"}
        if notes:
            task["notes"] = notes
        tasks.append(task)
        _save(tasks)
        return f"Added: [{task['id']}] {task['step']}"

    if operation == "update":
        if not task_id:
            return "Error: task_id is required for update"
        matches = [t for t in tasks if t["id"] == task_id]
        if not matches:
            ids = ", ".join(t["id"] for t in tasks)
            return f"Task '{task_id}' not found. Available: {ids or 'none'}"
        t = matches[0]
        if status:
            t["status"] = status
        if notes is not None:
            t["notes"] = notes
        _save(tasks)
        return f"Updated: {_render([t])}"

    if operation == "clear":
        _save([])
        return "Task list cleared."

    return f"Unknown operation: {operation!r} (use list|add|update|clear)"
