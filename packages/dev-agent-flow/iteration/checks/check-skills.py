#!/usr/bin/env python3
"""Check skill SKILL.md files declared in manifest exist and declare matching name."""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import fail, load_manifest, ok, orch_path, read_text  # noqa: E402


def frontmatter_name(text: str) -> str | None:
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return None
    for line in m.group(1).splitlines():
        if line.startswith("name:"):
            return line.split(":", 1)[1].strip().strip("\"'")
    return None


def main() -> None:
    m = load_manifest()
    for skill in m["skills"]:
        path = orch_path(skill["path"])
        text = read_text(path)
        declared = frontmatter_name(text)
        if declared != skill["name"]:
            fail(f"{skill['path']} frontmatter name={declared!r}, expected {skill['name']!r}")
        ok(f"skill {skill['name']} present")


if __name__ == "__main__":
    main()
