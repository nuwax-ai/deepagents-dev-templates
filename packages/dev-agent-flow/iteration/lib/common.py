#!/usr/bin/env python3
"""Shared paths/helpers for dev-agent-flow iteration checks."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

# packages/dev-agent-flow/
PKG_ROOT = Path(__file__).resolve().parents[2]
ORCH_ROOT = PKG_ROOT / "orchestration"
ITERATION_ROOT = PKG_ROOT / "iteration"
# Back-compat alias for older check imports
HARNESS_ROOT = ITERATION_ROOT
MANIFEST_PATH = ORCH_ROOT / "agent.manifest.json"
SAMPLE_PLATFORM_PATH = ITERATION_ROOT / "fixtures" / "platform-agent.sample.json"


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_manifest() -> dict[str, Any]:
    if not MANIFEST_PATH.is_file():
        fail(f"missing manifest: {MANIFEST_PATH}")
    return load_json(MANIFEST_PATH)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def ok(msg: str) -> None:
    print(f"OK: {msg}")


def read_text(path: Path) -> str:
    if not path.is_file():
        fail(f"missing file: {path}")
    return path.read_text(encoding="utf-8")


def orch_path(relative: str) -> Path:
    """Resolve a path declared in agent.manifest.json (relative to orchestration/)."""
    return ORCH_ROOT / relative


def section_present(text: str, name: str) -> bool:
    """Match <NAME> or bare NAME (user-prompt may only reference tags)."""
    if f"<{name}>" in text:
        return True
    if f"`<{name}>`" in text:
        return True
    return bool(re.search(rf"\b{re.escape(name)}\b", text))


def resolve_prompt_field(value: str, base: Path = ORCH_ROOT) -> str:
    """Expand {{INLINE_FROM:relative-path}} placeholders used in sample fixtures."""
    m = re.fullmatch(r"\{\{INLINE_FROM:(.+?)\}\}", value.strip())
    if not m:
        return value
    return read_text(base / m.group(1).strip())
