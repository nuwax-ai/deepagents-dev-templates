#!/usr/bin/env python3
"""Compare platform Agent detail projection vs agent.manifest.json.

Scope: prompts + Skill names + context7 Mcp tools only.
ask-question MUST NOT be required as type=Mcp on the orchestration page.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import (  # noqa: E402
    SAMPLE_PLATFORM_PATH,
    fail,
    load_json,
    load_manifest,
    ok,
    orch_path,
    read_text,
    resolve_prompt_field,
)


def component_list(data: dict[str, Any]) -> list[dict[str, Any]]:
    return list(data.get("agentComponentConfigList") or [])


def skill_names(components: list[dict[str, Any]]) -> set[str]:
    return {
        c.get("name")
        for c in components
        if c.get("type") == "Skill" and c.get("name")
    }


def mcp_tools_by_group(components: list[dict[str, Any]]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for c in components:
        if c.get("type") != "Mcp":
            continue
        group = c.get("groupName") or c.get("name") or ""
        tools = set()
        for t in c.get("tools") or []:
            if isinstance(t, str):
                tools.add(t)
            elif isinstance(t, dict) and t.get("name"):
                tools.add(t["name"])
        out[group] = tools
    return out


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--platform",
        type=Path,
        default=SAMPLE_PLATFORM_PATH,
        help="Platform Agent detail JSON (data object or full envelope with data)",
    )
    parser.add_argument(
        "--hash-only",
        action="store_true",
        help="Compare prompt sha256 instead of full text (useful for large dumps)",
    )
    args = parser.parse_args()

    m = load_manifest()
    raw = load_json(args.platform)
    data = raw.get("data", raw) if isinstance(raw, dict) else raw
    if not isinstance(data, dict):
        fail("platform JSON must be an object (or {data: ...})")

    ignore = set((m.get("platformExtras") or {}).get("ignoreTypesInDrift") or [])
    components = [
        c
        for c in component_list(data)
        if c.get("type") not in ignore
    ]

    # --- prompts ---
    for side, meta in m["prompts"].items():
        local = read_text(orch_path(meta["path"]))
        field = meta["platformField"]
        remote_raw = data.get(field)
        if remote_raw is None:
            fail(f"platform missing field {field}")
        remote = resolve_prompt_field(str(remote_raw))
        if args.hash_only:
            if sha256_text(local) != sha256_text(remote):
                fail(f"prompt drift ({field}): sha256 mismatch")
        else:
            if local.strip() != remote.strip():
                fail(
                    f"prompt drift ({field}): content differs from {meta['path']} "
                    f"(local={len(local)} chars, remote={len(remote)} chars)"
                )
        ok(f"platform-drift prompts.{side} aligned")

    # --- skills ---
    expected_skills = {s["name"] for s in m["skills"]}
    actual_skills = skill_names(components)
    if expected_skills != actual_skills:
        fail(
            "skill name set drift: "
            f"expected={sorted(expected_skills)} actual={sorted(actual_skills)}"
        )
    ok("platform-drift skills set aligned")

    # --- context7 binding ---
    mcp_map = mcp_tools_by_group(components)
    for server in m["mcp"]["devAgent"]["servers"]:
        name = server["name"]
        expected_tools = set(server.get("tools") or [])
        actual_tools = mcp_map.get(name, set())
        if not actual_tools:
            fail(f"platform missing Mcp binding for {name}")
        missing = expected_tools - actual_tools
        if missing:
            fail(f"platform {name} missing tools: {sorted(missing)}")
        ok(f"platform-drift mcp {name} tools bound")

    # --- ask-question must NOT be required ---
    # If present as Mcp, warn but do not fail (host may also register it).
    aq_as_mcp = any(
        (c.get("groupName") == "ask-question" or c.get("name") == "ask-question")
        and c.get("type") == "Mcp"
        for c in component_list(data)
    )
    if aq_as_mcp:
        print(
            "NOTE: platform lists ask-question as type=Mcp; "
            "harness does not require this (host default)."
        )
    else:
        ok("platform-drift ask-question not required as orchestration Mcp (pass)")

    ok(f"platform-drift against {args.platform}")


if __name__ == "__main__":
    main()
