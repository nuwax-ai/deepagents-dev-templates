"""Config merge primitives — layered merge with array-concat semantics."""

from __future__ import annotations

from typing import Any

from deepagents_template.runtime.config.deep_merge import deepMerge


def setNestedValue(obj: dict[str, Any], path: str, value: Any) -> None:
    keys = path.split(".")
    current = obj
    for key in keys[:-1]:
        if key not in current or current[key] is None or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[keys[-1]] = value


def concatUnique(a: list[str], b: list[str]) -> list[str]:
    seen = set(a)
    result = list(a)
    for item in b:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def isRecord(value: Any) -> bool:
    return isinstance(value, dict)


def mergeConfigLayer(config: dict[str, Any], layer: dict[str, Any]) -> dict[str, Any]:
    prev_skills = config.get("skills", {}).get("directories", [])
    prev_agents = config.get("agentsDirectories", [])
    prev_mcp_paths = config.get("mcp", {}).get("configPaths", [])
    prev_mcp_servers = config.get("mcp", {}).get("servers", {})
    prev_plugin_dirs = config.get("plugins", {}).get("directories", [])
    merged = deepMerge(config, layer)
    if "skills" in layer and "directories" in layer.get("skills", {}):
        merged["skills"]["directories"] = concatUnique(
            list(prev_skills), list(layer["skills"]["directories"])
        )
    if "agentsDirectories" in layer:
        merged["agentsDirectories"] = concatUnique(
            list(prev_agents), list(layer["agentsDirectories"])
        )
    if "mcp" in layer and "configPaths" in layer.get("mcp", {}):
        merged["mcp"]["configPaths"] = concatUnique(
            list(prev_mcp_paths), list(layer["mcp"]["configPaths"])
        )
    if "mcp" in layer and "servers" in layer.get("mcp", {}):
        merged["mcp"]["servers"] = {**prev_mcp_servers, **layer["mcp"]["servers"]}
    if "plugins" in layer and "directories" in layer.get("plugins", {}):
        merged["plugins"]["directories"] = concatUnique(
            list(prev_plugin_dirs), list(layer["plugins"]["directories"])
        )
    return merged
