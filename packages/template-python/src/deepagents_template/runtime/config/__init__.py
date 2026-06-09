"""Configuration system — Python port of TS src/runtime/config/.

Mirrors the TS template's 6-layer priority chain:
defaults < user .deepagents < project .deepagents < template config < env vars < ACP/session meta.

Modules
-------
* ``config_schema`` — Pydantic models for the full AppConfig
* ``config_paths`` — Filesystem path resolution
* ``config_sources`` — Load/source config data from files, env, plugins
* ``config_merge`` — Layered merge with array-concat semantics
* ``deep_merge`` — Generic recursive merge utility
* ``config_loader`` — Orchestration entry point

The ``AppConfig`` model and ``loadConfig`` are the canonical exports.
"""

from __future__ import annotations

from deepagents_template.runtime.config.config_loader import (
    loadConfig,
    resolveConfiguredWorkspaceRoot,
)
from deepagents_template.runtime.config.config_merge import (
    concatUnique,
    isRecord,
    mergeConfigLayer,
    setNestedValue,
)
from deepagents_template.runtime.config.config_paths import (
    TEMPLATE_PACKAGE_ROOT,
    deepAgentsHome,
    readBuiltinTemplateConfigNameFromEnv,
    resolveBuiltinTemplateConfig,
    resolveConfigResourcePath,
    resolvePath,
)
from deepagents_template.runtime.config.config_schema import (
    AppConfig,
    CompactionConfig,
    EvictionConfig,
    PermissionsConfig,
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
from deepagents_template.runtime.config.deep_merge import deepMerge

__all__ = [
    "TEMPLATE_PACKAGE_ROOT",
    "AppConfig",
    "CompactionConfig",
    "EvictionConfig",
    "PermissionsConfig",
    "concatUnique",
    "deepAgentsHome",
    "deepMerge",
    "inferModelProviderIfUnset",
    "isRecord",
    "loadConfig",
    "loadFromEnv",
    "loadJsonFile",
    "loadMcpOverlayFromFile",
    "loadModelsOverlayFromFile",
    "loadPluginOverlay",
    "mergeConfigLayer",
    "normalizeConfigResourcePaths",
    "readBuiltinTemplateConfigNameFromEnv",
    "resolveBuiltinTemplateConfig",
    "resolveConfigResourcePath",
    "resolveConfiguredWorkspaceRoot",
    "resolvePath",
    "setNestedValue",
]
