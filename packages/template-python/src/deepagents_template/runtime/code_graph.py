"""Code graph generator — generates a relationship graph of agent components.

Port of the TS ``code-graph.ts``. Walks the package directory and returns
a JSON graph of nodes (entrypoints, runtime, tools, skills, subagents,
prompts, config) and edges (calls, loads, configures, packages).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def generate_code_graph(  # noqa: C901
    root: str | None = None, template_package_root: str | None = None
) -> dict[str, Any]:
    """Generate the code relationship graph for the template package."""
    root_path: Path = Path(root) if root else Path.cwd()
    pkg_root = Path(template_package_root) if template_package_root else root_path
    src_dir = pkg_root / "src" / "deepagents_template"
    root = str(root_path)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    # Check if a path exists and add node
    def _add_if_exists(node: dict[str, Any]) -> None:
        p = Path(node["path"])
        if not p.is_absolute():
            p = Path(root) / node["path"]
        if p.exists():
            try:
                rel = p.relative_to(Path(root))
            except ValueError:
                rel = p
            nodes.append({**node, "path": str(rel)})

    # Entrypoint
    _add_if_exists({
        "id": "entry:main",
        "label": "ACP/CLI entrypoint",
        "kind": "entrypoint",
        "path": "src/deepagents_template/main.py",
        "editable": "protected",
    })

    # Runtime nodes
    runtime_src = src_dir / "runtime"
    for node_def in [
        ("runtime:config-loader", "Config loader", "runtime/config/config_loader.py"),
        ("runtime:helpers", "Runtime helpers", "runtime/helpers.py"),
        ("runtime:platform-client", "Platform client", "runtime/platform/platform_client.py"),
        ("runtime:mcp-manager", "MCP manager", "runtime/platform/mcp_manager.py"),
        ("runtime:variables", "Variable manager", "runtime/platform/variable_manager.py"),
        ("runtime:harness-lifecycle", "Harness lifecycle", "runtime/storage/harness_lifecycle.py"),
        ("runtime:code-graph", "Code graph generator", "runtime/code_graph.py"),
    ]:
        _add_if_exists({
            "id": node_def[0],
            "label": node_def[1],
            "kind": "runtime",
            "path": f"src/deepagents_template/{node_def[2]}",
            "editable": "protected",
        })

    # Middleware nodes
    mw_dir = runtime_src / "middleware"
    if mw_dir.exists():
        for mw_file in sorted(mw_dir.glob("*.py")):
            if mw_file.name == "__init__.py":
                continue
            label = mw_file.stem.replace("_", " ").title()
            _add_if_exists({
                "id": f"middleware:{mw_file.stem}",
                "label": label,
                "kind": "middleware",
                "path": f"src/deepagents_template/runtime/middleware/{mw_file.name}",
                "editable": "protected",
            })

    # Tool nodes
    tools_dir = src_dir / "app" / "tools"
    if tools_dir.exists():
        for tool_file in sorted(tools_dir.glob("*.py")):
            if tool_file.name == "__init__.py":
                continue
            label = tool_file.stem.replace("_", " ").title()
            _add_if_exists({
                "id": f"tool:{tool_file.stem}",
                "label": label,
                "kind": "tool",
                "path": f"src/deepagents_template/app/tools/{tool_file.name}",
                "editable": "ai-user",
            })

    # Config/prompt/skill nodes
    for node_def in [
        ("config:app", "Application config", "config/app-agent.config.json",
         "config", "user-platform"),
        ("config:mcp", "Default MCP config", "config/mcp.default.json",
         "config", "user-platform"),
        ("manifest:template", "Template manifest", "template.manifest.json",
         "distribution", "ai-user"),
        ("manifest:package", "Agent package manifest", "agent-package.json",
         "distribution", "ai-user"),
    ]:
        _add_if_exists({
            "id": node_def[0],
            "label": node_def[1],
            "kind": node_def[3],
            "path": node_def[2],
            "editable": node_def[4],
        })

    # Skills
    skills_builtin = pkg_root / "skills" / "builtin"
    skills_platform = pkg_root / "skills" / "platform"
    for skill_dir in [skills_builtin, skills_platform]:
        if skill_dir.exists():
            for skill_md in sorted(skill_dir.rglob("SKILL.md")):
                try:
                    rel = skill_md.relative_to(pkg_root)
                except ValueError:
                    rel = skill_md
                nodes.append({
                    "id": f"skill:{skill_md.parent.name}",
                    "label": skill_md.parent.name,
                    "kind": "skill",
                    "path": str(rel),
                    "editable": "ai-user",
                })

    # Links
    edges = [
        {"from": "entry:main", "to": "runtime:config-loader", "kind": "calls"},
        {"from": "entry:main", "to": "runtime:helpers", "kind": "calls"},
        {"from": "runtime:helpers", "to": "runtime:platform-client", "kind": "configures"},
        {"from": "runtime:helpers", "to": "runtime:mcp-manager", "kind": "configures"},
        {"from": "runtime:helpers", "to": "runtime:variables", "kind": "configures"},
        {"from": "runtime:helpers", "to": "runtime:harness-lifecycle", "kind": "configures"},
        {"from": "runtime:config-loader", "to": "config:app", "kind": "loads"},
        {"from": "runtime:mcp-manager", "to": "config:mcp", "kind": "loads"},
    ]
    # Add edges that only reference existing nodes
    existing_ids = {n["id"] for n in nodes}
    edges = [
        e for e in edges
        if e["from"] in existing_ids and e["to"] in existing_ids
    ]

    return {
        "schema": "nuwaclaw.agent-code-graph.v1",
        "generatedAt": datetime.now(UTC).isoformat(),
        "root": str(Path(root).resolve()),
        "nodes": nodes,
        "edges": edges,
    }


def write_code_graph(output_path: str, root: str | None = None) -> dict[str, Any]:
    graph = generate_code_graph(root)
    Path(output_path).write_text(json.dumps(graph, indent=2, default=str), encoding="utf-8")
    return graph
