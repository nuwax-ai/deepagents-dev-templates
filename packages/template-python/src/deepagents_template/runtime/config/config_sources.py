"""Config sources — load/config overlays from files, env, and plugins."""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
from typing import Any

from deepagents_template.runtime.config.config_merge import setNestedValue
from deepagents_template.runtime.config.config_paths import resolveConfigResourcePath, resolvePath
from deepagents_template.runtime.logger import logger


def loadJsonFile(filePath: str, baseDir: str | None = None) -> dict[str, Any] | None:
    resolved = resolvePath(filePath, baseDir or os.getcwd())
    p = Path(resolved)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning(f"Failed to parse config file: {resolved}", extra={"error": str(exc)})
        return None


def normalizeConfigResourcePaths(config: dict[str, Any], baseDir: str) -> None:
    mcp = config.get("mcp")
    if isinstance(mcp, dict):
        if isinstance(mcp.get("configPath"), str):
            mcp["configPath"] = resolveConfigResourcePath(mcp["configPath"], baseDir)
        if isinstance(mcp.get("configPaths"), list):
            mcp["configPaths"] = [
                resolveConfigResourcePath(e, baseDir) if isinstance(e, str) else e
                for e in mcp["configPaths"]
            ]
    skills = config.get("skills")
    if isinstance(skills, dict) and isinstance(skills.get("directories"), list):
        skills["directories"] = [
            resolveConfigResourcePath(e, baseDir) if isinstance(e, str) else e
            for e in skills["directories"]
        ]
    if isinstance(config.get("agentsDirectories"), list):
        config["agentsDirectories"] = [
            resolveConfigResourcePath(e, baseDir) if isinstance(e, str) else e
            for e in config["agentsDirectories"]
        ]
    memory = config.get("memory")
    if isinstance(memory, dict) and isinstance(memory.get("dir"), str):
        memory["dir"] = resolveConfigResourcePath(memory["dir"], baseDir)
    agent = config.get("agent")
    if isinstance(agent, dict) and isinstance(agent.get("systemPromptPath"), str):
        agent["systemPromptPath"] = resolveConfigResourcePath(agent["systemPromptPath"], baseDir)


def loadModelsOverlayFromFile(filePath: str) -> dict[str, Any] | None:
    raw = loadJsonFile(filePath)
    if raw is None:
        return None
    if "model" in raw and isinstance(raw["model"], dict):
        return raw
    if "default" in raw and isinstance(raw["default"], dict):
        return {"model": raw["default"]}
    return {"model": raw}


def loadMcpOverlayFromFile(filePath: str) -> dict[str, Any] | None:
    p = Path(resolvePath(filePath))
    if not p.exists():
        return None
    return {"mcp": {"configPaths": [str(p)]}}


ENV_MAP: dict[str, str] = {
    "ACP_AGENT_NAME": "agent.name",
    "ACP_AGENT_DESCRIPTION": "agent.description",
    "AGENT_SYSTEM_PROMPT": "agent.systemPrompt",
    "AGENT_SYSTEM_PROMPT_PATH": "agent.systemPromptPath",
    "DEEPAGENTS_WORKING_DIR": "workspace.workingDir",
    "AGENT_WORKING_DIR": "workspace.workingDir",
    "PLATFORM_API_BASE_URL": "platform.apiBaseUrl",
    "PLATFORM_AGENT_ID": "platform.agentId",
    "PLATFORM_SPACE_ID": "platform.spaceId",
    "DEFAULT_MODEL": "model.name",
    "ANTHROPIC_MODEL": "model.name",
    "ANTHROPIC_BASE_URL": "model.baseUrl",
    "OPENAI_MODEL": "model.name",
    "OPENAI_BASE_URL": "model.baseUrl",
    "LLM_PROVIDER": "model.provider",
    "MAX_TOKENS": "model.settings.maxTokens",
    "MCP_CONFIG_PATH": "mcp.configPath",
    "LOG_LEVEL": "logging.level",
    "DEEPAGENTS_PERMISSIONS_MODE": "permissions.mode",
    "DEEPAGENTS_SANDBOX_PROFILE": "sandbox.profile",
}

NUMERIC_ENV_KEYS: set[str] = {"MAX_TOKENS"}


def loadFromEnv() -> dict[str, Any]:
    overlay: dict[str, Any] = {}
    for env_key, config_path in ENV_MAP.items():
        value = os.environ.get(env_key)
        if value and value != "":
            if env_key in NUMERIC_ENV_KEYS:
                with contextlib.suppress(ValueError):
                    setNestedValue(overlay, config_path, int(value))
            else:
                setNestedValue(overlay, config_path, value)
    acp_debug = os.environ.get("ACP_DEBUG")
    if acp_debug in ("true", "1"):
        setNestedValue(overlay, "logging.level", "debug")
    return overlay


def inferModelProviderIfUnset(config: dict[str, Any]) -> dict[str, Any]:
    explicit = (os.environ.get("LLM_PROVIDER") or "").strip().lower()
    if explicit in ("openai", "anthropic"):
        return config
    has_openai = bool(
        os.environ.get("OPENAI_API_KEY", "").strip()
        or os.environ.get("OPENAI_BASE_URL", "").strip()
    )
    has_anthropic = bool(
        os.environ.get("ANTHROPIC_API_KEY", "").strip()
        or os.environ.get("ANTHROPIC_AUTH_TOKEN", "").strip()
        or os.environ.get("ANTHROPIC_BASE_URL", "").strip()
    )
    provider: str | None = None
    if has_openai and not has_anthropic:
        provider = "openai"
    elif has_anthropic and not has_openai:
        provider = "anthropic"
    elif has_openai and has_anthropic and os.environ.get("OPENAI_API_KEY", "").strip():
        provider = "openai"
    if not provider or provider == config.get("model", {}).get("provider"):
        return config
    model = dict(config.get("model", {}))
    model["provider"] = provider
    if provider == "openai":
        model["apiKeyEnv"] = "OPENAI_API_KEY"
    result = dict(config)
    result["model"] = model
    return result


def discoverPluginManifests(pluginRoot: str) -> list[str]:
    root = Path(pluginRoot)
    if not root.exists():
        return []
    root_manifest = root / "plugin.json"
    if root_manifest.exists():
        return [str(root_manifest)]
    results: list[str] = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            mf = entry / "plugin.json"
            if mf.exists():
                results.append(str(mf))
    return results


def loadPluginOverlay(config: dict[str, Any], workspaceRoot: str) -> dict[str, Any] | None:
    overlay: dict[str, Any] = {}
    enabled_set = set(config.get("plugins", {}).get("enabled", []))
    disabled_set = set(config.get("plugins", {}).get("disabled", []))
    for plugin_dir in config.get("plugins", {}).get("directories", []):
        resolved_dir = resolvePath(plugin_dir, workspaceRoot)
        for manifest_path in discoverPluginManifests(resolved_dir):
            manifest = loadJsonFile(manifest_path)
            if not manifest:
                continue
            plugin_id = manifest.get("id") or manifest.get("name") or manifest_path
            if manifest.get("enabled") is False or plugin_id in disabled_set:
                continue
            if enabled_set and plugin_id not in enabled_set and "*" not in enabled_set:
                continue
            base_dir = str(Path(manifest_path).parent)
            skills_dirs = manifest.get("skillsDirectories", [])
            if skills_dirs:
                existing = overlay.setdefault("skills", {}).setdefault("directories", [])
                existing.extend(resolvePath(p, base_dir) for p in skills_dirs)
            agents_dirs = manifest.get("agentsDirectories", [])
            if agents_dirs:
                existing = overlay.setdefault("agentsDirectories", [])
                existing.extend(resolvePath(p, base_dir) for p in agents_dirs)
            hooks = manifest.get("hooks", [])
            if hooks:
                overlay.setdefault("hooks", []).extend(hooks)
            mcp = manifest.get("mcp", {}) or {}
            mcp_servers = manifest.get("mcpServers", {}) or {}
            config_paths = list(mcp.get("configPaths", []))
            if mcp.get("configPath"):
                config_paths.append(mcp["configPath"])
            if config_paths or mcp_servers:
                mcp_overlay = overlay.setdefault("mcp", {})
                mcp_overlay.setdefault("configPaths", []).extend(
                    resolvePath(p, base_dir) for p in config_paths
                )
                existing_servers = mcp_overlay.setdefault("servers", {})
                existing_servers.update(mcp.get("servers", {}))
                existing_servers.update(mcp_servers)
    return overlay if overlay else None
