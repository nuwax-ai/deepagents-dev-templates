#!/usr/bin/env python3
"""Check MCP usage contracts: L0 markers + templateBuiltin config presence.

Does NOT require ask-question on the orchestration page (host default).
Does NOT modify MCP implementations.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import PKG_ROOT, fail, load_manifest, ok, orch_path, read_text  # noqa: E402


def main() -> None:
    m = load_manifest()
    system = read_text(orch_path(m["prompts"]["system"]["path"]))
    user = read_text(orch_path(m["prompts"]["user"]["path"]))
    l0 = system + "\n" + user

    # --- context7 (devAgent) ---
    for server in m["mcp"]["devAgent"]["servers"]:
        markers = server.get("l0Markers") or server.get("tools") or []
        missing = [x for x in markers if x not in l0]
        if missing:
            fail(
                f"L0 missing context7 usage markers for {server['name']}: "
                f"{', '.join(missing)} (add short usage guidance to system-prompt)"
            )
        order = server.get("toolOrder") or []
        tools = server.get("tools") or []
        if order and order != tools[: len(order)] and set(order) != set(tools):
            # soft: toolOrder should be a permutation / prefix of tools
            if set(order) - set(tools):
                fail(f"{server['name']}.toolOrder has unknown tools: {order}")
        ok(f"mcp-usage context7 ({server['name']}) L0 markers present")

    # --- ask-question (hostDefaults) ---
    aq = m["mcp"]["hostDefaults"]["ask-question"]
    markers = aq.get("l0Markers") or [aq.get("toolName", "ask-question")]
    missing = [x for x in markers if x not in l0]
    if missing:
        fail(
            "L0 missing ask-question host usage markers: "
            f"{', '.join(missing)} (OUTPUT_FORMAT / HITL short guidance)"
        )
    ok("mcp-usage ask-question host L0 markers present")

    # --- templateBuiltin: file exists + command/args match ---
    tpl = m["mcp"]["templateBuiltin"]["ask-question"]
    tpl_path = (PKG_ROOT / tpl["path"]).resolve()
    if not tpl_path.is_file():
        fail(f"templateBuiltin ask-question path missing: {tpl_path}")
    with tpl_path.open(encoding="utf-8") as f:
        cfg = json.load(f)
    servers = cfg.get("servers") or {}
    entry = servers.get("ask-question")
    if not entry:
        fail(f"{tpl_path} missing servers.ask-question")
    expected = tpl.get("serverConfig") or {}
    if entry.get("command") != expected.get("command"):
        fail(
            f"template ask-question command={entry.get('command')!r}, "
            f"expected {expected.get('command')!r}"
        )
    if entry.get("args") != expected.get("args"):
        fail(
            f"template ask-question args={entry.get('args')!r}, "
            f"expected {expected.get('args')!r}"
        )
    ok("mcp-usage templateBuiltin ask-question config matches manifest")


if __name__ == "__main__":
    main()
