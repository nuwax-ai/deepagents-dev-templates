#!/usr/bin/env python3
"""Validate agent.manifest.json shape (lightweight; schema is documentation + soft check)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import fail, load_manifest, ok  # noqa: E402


def main() -> None:
    m = load_manifest()
    for key in ("version", "agent", "prompts", "skills", "mcp"):
        if key not in m:
            fail(f"manifest missing top-level key: {key}")

    prompts = m["prompts"]
    for side in ("system", "user"):
        if side not in prompts:
            fail(f"manifest.prompts missing {side}")
        for field in ("path", "platformField", "requiredSections"):
            if field not in prompts[side]:
                fail(f"manifest.prompts.{side} missing {field}")

    skills = m["skills"]
    if len(skills) < 3:
        fail("manifest.skills must list at least 3 skills")
    names = [s.get("name") for s in skills]
    for expected in ("flow-builder", "dev-engineer-toolkit", "flow-debugger"):
        if expected not in names:
            fail(f"manifest.skills missing {expected}")

    mcp = m["mcp"]
    for key in ("devAgent", "hostDefaults", "templateBuiltin"):
        if key not in mcp:
            fail(f"manifest.mcp missing {key}")

    servers = mcp["devAgent"].get("servers") or []
    ctx = next((s for s in servers if s.get("name") == "context7"), None)
    if not ctx:
        fail("manifest.mcp.devAgent.servers must include context7")
    if ctx.get("tune") != "usage-only":
        fail("context7.tune must be usage-only")
    tools = ctx.get("tools") or []
    for t in ("resolve-library-id", "query-docs"):
        if t not in tools:
            fail(f"context7.tools missing {t}")

    aq = (mcp["hostDefaults"] or {}).get("ask-question")
    if not aq:
        fail("manifest.mcp.hostDefaults.ask-question required")
    if aq.get("tune") != "usage-only":
        fail("ask-question.tune must be usage-only")
    if aq.get("toolName") != "nuwax_ask_question":
        fail("ask-question.toolName must be nuwax_ask_question")
    if "github.com/nuwax-ai/nuwax-ask-question-mcp" not in (aq.get("referenceRepo") or ""):
        fail("ask-question.referenceRepo must point at nuwax-ai/nuwax-ask-question-mcp")

    tpl = (mcp["templateBuiltin"] or {}).get("ask-question")
    if not tpl or "serverConfig" not in tpl:
        fail("manifest.mcp.templateBuiltin.ask-question.serverConfig required")

    ok("agent.manifest.json structure")


if __name__ == "__main__":
    main()
