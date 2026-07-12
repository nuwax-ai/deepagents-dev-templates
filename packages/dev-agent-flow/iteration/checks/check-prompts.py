#!/usr/bin/env python3
"""Check prompt files exist and contain required sections from manifest."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import fail, load_manifest, ok, orch_path, read_text, section_present  # noqa: E402


def main() -> None:
    m = load_manifest()
    for side, meta in m["prompts"].items():
        path = orch_path(meta["path"])
        text = read_text(path)
        missing = [s for s in meta["requiredSections"] if not section_present(text, s)]
        if missing:
            fail(f"{meta['path']} missing sections/markers: {', '.join(missing)}")
        ok(f"prompts.{side} ({meta['path']}) sections present")


if __name__ == "__main__":
    main()
