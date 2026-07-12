#!/usr/bin/env python3
"""Reject local OS/editor artifacts from orchestration delivery files."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import ORCH_ROOT, fail, ok  # noqa: E402


DISALLOWED_NAMES = {".DS_Store"}
DISALLOWED_PREFIXES = {"__MACOSX"}


def main() -> None:
    offenders: list[str] = []
    for path in ORCH_ROOT.rglob("*"):
        if path.name in DISALLOWED_NAMES or any(
            part in DISALLOWED_PREFIXES for part in path.relative_to(ORCH_ROOT).parts
        ):
            offenders.append(str(path.relative_to(ORCH_ROOT)))

    if offenders:
        fail("orchestration contains local artifact files: " + ", ".join(sorted(offenders)))

    ok("orchestration has no local artifact files")


if __name__ == "__main__":
    main()
