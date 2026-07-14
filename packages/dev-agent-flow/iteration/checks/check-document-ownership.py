#!/usr/bin/env python3
"""Keep template facts single-sourced and critical guidance reachable from L0."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from common import PKG_ROOT, fail, ok, read_text  # noqa: E402


def require_markers(label: str, text: str, markers: tuple[str, ...]) -> None:
    missing = [marker for marker in markers if marker not in text]
    if missing:
        fail(f"{label} missing guidance markers: {', '.join(missing)}")


def main() -> None:
    ownership = PKG_ROOT / "docs" / "documentation-ownership.md"
    system_prompt = PKG_ROOT / "orchestration" / "system-prompt.md"
    user_prompt = PKG_ROOT / "orchestration" / "user-prompt.md"
    package_readme = PKG_ROOT / "README.md"
    flow_builder = PKG_ROOT / "orchestration" / "skills" / "flow-builder"
    part0 = flow_builder / "references" / "part0-workflow.md"
    part3 = flow_builder / "references" / "part3-tools-config.md"
    template_root = PKG_ROOT.parent / "deepagents-flow-ts"
    template_readme = template_root / "README.md"
    glossary = template_root / "docs" / "glossary.md"

    ownership_text = read_text(ownership)
    for marker in ("## 权责表", "## 写作规则", "唯一权威正文"):
        if marker not in ownership_text:
            fail(f"documentation ownership file missing marker: {marker}")

    prompt_text = read_text(system_prompt)
    user_text = read_text(user_prompt)
    l0_text = prompt_text + "\n" + user_text
    part0_text = read_text(part0)
    part3_text = read_text(part3)
    template_readme_text = read_text(template_readme)
    glossary_text = read_text(glossary)

    require_markers(
        "L0 template authority route",
        prompt_text,
        ("docs/README.md", "docs/examples.md", "docs/flow-graph-rules.md", "docs/node-kit.md"),
    )
    require_markers(
        "L0 mandatory workflow route",
        l0_text,
        ("flow-builder", "Part 0", "dev-engineer-toolkit", "search / get-config / add-tool", "flow-debugger"),
    )
    require_markers(
        "L0 platform completion gate",
        prompt_text,
        ("systemPrompt", "回读", "未验证不得报", "工程验证矩阵", "运行时自动追加"),
    )
    require_markers(
        "platform capability pre-code gate",
        part0_text + "\n" + part3_text,
        ("写图前", "get-config.sh --key tools --full", "platformToolRefs", "手写 fetch", "4sandbox"),
    )
    require_markers(
        "delivery policy narrowing",
        ownership_text + "\n" + prompt_text,
        ("行为策略可以收窄", "交付策略", "模板运行时支持 `.agents/`"),
    )
    require_markers(
        "template engineering authority",
        template_readme_text,
        ("工程验证矩阵（模板权威）", "CommonJS `require()`", "无 `any`"),
    )

    for forbidden in ("<SESSION_CLOSE>", "开发 Agent system-prompt", "flow-builder Part"):
        if forbidden in glossary_text:
            fail(f"template glossary must not reference development Agent guidance: {forbidden}")
    for legacy_section in ("<INTERACTION_CLASSIFY>", "<TEMPLATE_CONSTRAINTS>"):
        if legacy_section in prompt_text:
            fail(f"system prompt must not restore duplicated template section: {legacy_section}")

    if "docs/documentation-ownership.md" not in read_text(package_readme):
        fail("package README must link to documentation ownership rules")

    ok("documentation ownership and critical guidance coverage present")


if __name__ == "__main__":
    main()
