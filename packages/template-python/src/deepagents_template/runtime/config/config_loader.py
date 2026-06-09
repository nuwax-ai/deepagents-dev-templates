"""Configuration loader — orchestrates the 6-layer priority chain.

Port of TS ``config-loader.ts``. Implements:
  defaults < user .deepagents < project .deepagents < template config < env < ACP session
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from deepagents_template.runtime.config.config_merge import mergeConfigLayer, setNestedValue
from deepagents_template.runtime.config.config_paths import (
    deepAgentsHome,
    readBuiltinTemplateConfigNameFromEnv,
    resolveBuiltinTemplateConfig,
    resolvePath,
)
from deepagents_template.runtime.config.config_schema import (
    ACPSessionConfig,
    AppConfig,
)
from deepagents_template.runtime.config.config_sources import (
    inferModelProviderIfUnset,
    loadFromEnv,
    loadJsonFile,
    loadMcpOverlayFromFile,
    loadModelsOverlayFromFile,
    loadPluginOverlay,
    normalizeConfigResourcePaths,
)

DEFAULTS: dict[str, Any] = AppConfig().model_dump()


def loadConfig(options: dict[str, Any] | None = None) -> AppConfig:
    opts = options or {}
    builtin_cfg = resolveBuiltinTemplateConfig(
        opts.get("builtinConfig") or readBuiltinTemplateConfigNameFromEnv()
    )
    env_config_path = (
        os.environ.get("DEEPAGENTS_CONFIG_PATH") or os.environ.get("APP_AGENT_CONFIG_PATH")
    )
    config_path = opts.get("configPath") or env_config_path or builtin_cfg["path"]
    user_dir = deepAgentsHome()
    env_workspace_root = (
        os.environ.get("DEEPAGENTS_WORKING_DIR") or os.environ.get("AGENT_WORKING_DIR")
    )
    workspace_root = _resolve_workspace_root(
        opts.get("workspaceRoot"),
        opts.get("sessionConfig", {}).get("cwd") if opts.get("sessionConfig") else None,
        env_workspace_root,
    )
    config: dict[str, Any] = dict(DEFAULTS)
    _load_user_level(config, user_dir)
    resolved_config_path = resolvePath(config_path, workspace_root)
    using_builtin = resolved_config_path == builtin_cfg["path"]
    config_base_dir = opts.get("configBaseDir") or (
        builtin_cfg["resourceBase"] if using_builtin else workspace_root
    )
    project_dir = str(Path(workspace_root) / ".deepagents")
    _load_project_level(config, project_dir)
    _load_file_config(config, resolved_config_path, using_builtin, config_base_dir)
    _load_plugin_overlays(config, workspace_root)
    _load_env_overlays(config)
    _load_session_overrides(config, opts.get("sessionConfig"), workspace_root)
    _validate_workspace_root(config, opts.get("workspaceRoot"), env_workspace_root)
    return AppConfig(**config)


def resolveConfiguredWorkspaceRoot(
    config: AppConfig | dict[str, Any], fallback: str | None = None
) -> str:
    if isinstance(config, AppConfig):
        wd = config.workspace.working_dir
    else:
        wd = config.get("workspace", {}).get("workingDir")
    return resolvePath(wd) if wd else (fallback or os.getcwd())


def _resolve_workspace_root(*candidates: str | None) -> str:
    for c in candidates:
        if c:
            return resolvePath(c)
    return os.getcwd()


def _load_user_level(config: dict[str, Any], user_dir: str) -> None:
    user_cfg = loadJsonFile(os.path.join(user_dir, "config.json"))
    if user_cfg:
        config.update(mergeConfigLayer(config, user_cfg))
    user_models = loadModelsOverlayFromFile(os.path.join(user_dir, "models.json"))
    if user_models:
        config.update(mergeConfigLayer(config, user_models))
    user_mcp = loadMcpOverlayFromFile(os.path.join(user_dir, "mcp.json"))
    if user_mcp:
        config.update(mergeConfigLayer(config, user_mcp))


def _load_project_level(config: dict[str, Any], project_dir: str) -> None:
    proj_cfg = loadJsonFile(os.path.join(project_dir, "config.json"))
    if proj_cfg:
        config.update(mergeConfigLayer(config, proj_cfg))
    proj_mcp = loadMcpOverlayFromFile(os.path.join(project_dir, "mcp.json"))
    if proj_mcp:
        config.update(mergeConfigLayer(config, proj_mcp))


def _load_file_config(
    config: dict[str, Any], config_path: str, using_builtin: bool, config_base_dir: str
) -> None:
    file_cfg = loadJsonFile(config_path)
    if file_cfg:
        if using_builtin:
            normalizeConfigResourcePaths(file_cfg, config_base_dir)
        config.update(mergeConfigLayer(config, file_cfg))


def _load_plugin_overlays(config: dict[str, Any], workspace_root: str) -> None:
    plugin_overlay = loadPluginOverlay(config, workspace_root)
    if plugin_overlay:
        config.update(mergeConfigLayer(config, plugin_overlay))


def _load_env_overlays(config: dict[str, Any]) -> None:
    env_cfg = loadFromEnv()
    config.update(mergeConfigLayer(config, env_cfg))
    config.update(inferModelProviderIfUnset(config))


def _load_session_overrides(
    config: dict[str, Any], session_config: Any | None, workspace_root: str
) -> None:
    if not session_config:
        return
    sc = session_config
    if isinstance(sc, ACPSessionConfig):
        sc = sc.model_dump(exclude_none=True)
    elif not isinstance(sc, dict):
        return
    overlay: dict[str, Any] = {}
    if sc.get("model"):
        setNestedValue(overlay, "model.name", sc["model"])
    if sc.get("agentId"):
        setNestedValue(overlay, "platform.agentId", sc["agentId"])
    if sc.get("spaceId"):
        setNestedValue(overlay, "platform.spaceId", sc["spaceId"])
    if overlay:
        config.update(mergeConfigLayer(config, overlay))


def _validate_workspace_root(
    config: dict[str, Any], explicit: str | None, env_root: str | None
) -> None:
    _ = explicit or env_root
