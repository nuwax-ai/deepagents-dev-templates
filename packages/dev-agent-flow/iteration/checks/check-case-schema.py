#!/usr/bin/env python3
"""Validate iteration/cases/*.json against case.schema.json (lightweight)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import ITERATION_ROOT, fail, load_json, ok  # noqa: E402

ALLOWED_DIMS = {"prompt", "skill", "mcp-context7", "mcp-ask-question"}
ALLOWED_CHECKS = {"prompts", "skills", "mcp-usage", "platform-drift", "manifest"}


def main() -> None:
    cases_dir = ITERATION_ROOT / "cases"
    if not cases_dir.is_dir():
        fail(f"missing cases dir: {cases_dir}")
    files = sorted(cases_dir.glob("*.json"))
    if not files:
        fail("no cases found")

    schema = load_json(ITERATION_ROOT / "case.schema.json")
    enum_dims = set(schema["properties"]["dimension"]["enum"])
    enum_checks = set(schema["properties"]["checks"]["items"]["enum"])

    for path in files:
        case = load_json(path)
        for key in ("id", "dimension", "title", "checks"):
            if key not in case:
                fail(f"{path.name} missing {key}")
        if case["dimension"] not in enum_dims or case["dimension"] not in ALLOWED_DIMS:
            fail(f"{path.name} invalid dimension: {case['dimension']}")
        if not isinstance(case["checks"], list) or not case["checks"]:
            fail(f"{path.name} checks must be non-empty list")
        for c in case["checks"]:
            if c not in enum_checks or c not in ALLOWED_CHECKS:
                fail(f"{path.name} invalid check: {c}")
        ok(f"case {case['id']}")

    ok(f"{len(files)} cases schema-ok")


if __name__ == "__main__":
    main()
