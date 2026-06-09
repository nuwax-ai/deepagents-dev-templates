"""Skill / memory / sub-agent discovery.

Port of the TypeScript template's ``runtime/discovery.ts``. Walks the
configured skill and memory directories, parses SKILL.md frontmatter, and
returns structured descriptors that the agent factory and code-graph can
consume.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


@dataclass
class SkillDescriptor:
    """Discovered skill definition (mirrors ``Skill`` in the TS template)."""

    name: str
    description: str
    path: Path
    tags: list[str] = field(default_factory=list)
    version: str = "0.0.0"
    body: str = ""
    source: str = "builtin"  # "builtin" | "platform" | "user"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "path": str(self.path),
            "tags": list(self.tags),
            "version": self.version,
            "source": self.source,
        }


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}, text
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        meta = {}
    body = text[match.end():]
    return meta if isinstance(meta, dict) else {}, body


def _classify(path: Path, builtin_root: Path, platform_root: Path) -> str:
    try:
        path.relative_to(platform_root)
        return "platform"
    except ValueError:
        pass
    try:
        path.relative_to(builtin_root)
        return "builtin"
    except ValueError:
        return "user"


def discover_skills(
    skill_dirs: Iterable[Path | str],
    *,
    workspace_root: Path | None = None,
) -> list[SkillDescriptor]:
    """Walk *skill_dirs* and return one :class:`SkillDescriptor` per SKILL.md."""
    skills: list[SkillDescriptor] = []
    builtin_root = (workspace_root or Path.cwd()) / "skills" / "builtin"
    platform_root = (workspace_root or Path.cwd()) / "skills" / "platform"
    for raw in skill_dirs:
        directory = Path(raw).expanduser().resolve()
        if not directory.exists():
            continue
        for skill_file in sorted(directory.rglob("SKILL.md")):
            text = skill_file.read_text(encoding="utf-8")
            meta, body = _parse_frontmatter(text)
            skills.append(
                SkillDescriptor(
                    name=str(meta.get("name") or skill_file.parent.name),
                    description=str(meta.get("description") or "").strip(),
                    path=skill_file,
                    tags=list(meta.get("tags") or []),
                    version=str(meta.get("version") or "0.0.0"),
                    body=body,
                    source=_classify(skill_file, builtin_root, platform_root),
                )
            )
    return skills


@dataclass
class MemoryFile:
    """A memory file picked up from the configured memory directory."""

    path: Path
    body: str
    bytes: int


def discover_memory_files(
    memory_dir: Path | str,
    *,
    include_workspace: bool = True,
) -> list[MemoryFile]:
    """Return all memory files under *memory_dir* (or workspace AGENTS.md)."""
    results: list[MemoryFile] = []
    directory = Path(memory_dir).expanduser().resolve()
    if directory.exists():
        for path in sorted(directory.rglob("*.md")):
            text = path.read_text(encoding="utf-8")
            results.append(MemoryFile(path=path, body=text, bytes=len(text.encode("utf-8"))))
    if include_workspace:
        for name in ("AGENTS.md", "CLAUDE.md", "README.md"):
            candidate = directory.parent / name if directory.exists() else Path.cwd() / name
            if candidate.exists() and candidate.is_file():
                text = candidate.read_text(encoding="utf-8")
                results.append(
                    MemoryFile(
                        path=candidate, body=text, bytes=len(text.encode("utf-8"))
                    )
                )
    return results


@dataclass
class DiscoveredSubAgent:
    """A sub-agent spec discovered under ``.agents/agents/``."""

    name: str
    description: str
    path: Path
    config: dict[str, Any] = field(default_factory=dict)


def discover_sub_agents(
    workspace_root: Path | str,
    *,
    agents_dir: str = ".agents",
) -> list[DiscoveredSubAgent]:
    """Find sub-agent specs under ``<workspace>/<agents_dir>/agents/``."""
    root = Path(workspace_root).expanduser().resolve()
    candidates = [root / agents_dir / "agents", root / agents_dir]
    found: list[DiscoveredSubAgent] = []
    seen: set[Path] = set()
    for directory in candidates:
        if not directory.exists():
            continue
        for path in sorted(directory.rglob("*.md")):
            if path in seen:
                continue
            seen.add(path)
            text = path.read_text(encoding="utf-8")
            meta, body = _parse_frontmatter(text)
            name = str(meta.get("name") or path.stem)
            found.append(
                DiscoveredSubAgent(
                    name=name,
                    description=str(meta.get("description") or "").strip(),
                    path=path,
                    config={
                        "name": name,
                        "description": str(meta.get("description") or "").strip(),
                        "body": body,
                    },
                )
            )
    return found
