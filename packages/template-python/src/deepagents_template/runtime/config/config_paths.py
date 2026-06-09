"""Config path resolution — port of TS ``config-paths.ts``."""

from __future__ import annotations

import os
from pathlib import Path

from deepagents_template.runtime.config.config_schema import (
    BUILTIN_TEMPLATE_CONFIGS,
    DEFAULT_BUILTIN_TEMPLATE_CONFIG,
)
from deepagents_template.runtime.logger import logger

TEMPLATE_PACKAGE_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent


def readBuiltinTemplateConfigNameFromEnv() -> str | None:
    name = os.environ.get("DEEPAGENTS_BUILTIN_CONFIG")
    if not name:
        return None
    if name in BUILTIN_TEMPLATE_CONFIGS:
        return name
    logger.warning(
        "Unknown DEEPAGENTS_BUILTIN_CONFIG; falling back to default",
        extra={"requested": name, "available": list(BUILTIN_TEMPLATE_CONFIGS.keys())},
    )
    return None


def resolveBuiltinTemplateConfig(name: str | None = None) -> dict[str, str]:
    name = name or DEFAULT_BUILTIN_TEMPLATE_CONFIG
    cfg = BUILTIN_TEMPLATE_CONFIGS[name]
    return {
        "path": str(TEMPLATE_PACKAGE_ROOT / cfg["path"]),
        "resourceBase": str(TEMPLATE_PACKAGE_ROOT / cfg["resourceBase"]),
    }


def deepAgentsHome() -> str:
    return os.environ.get("DEEPAGENTS_HOME") or str(Path.home() / ".deepagents")


def resolveConfigResourcePath(path: str, baseDir: str) -> str:
    if path.startswith("~/") or path.startswith("~/.deepagents/") or Path(path).is_absolute():
        return path
    return str(Path(baseDir) / path)


def resolvePath(filePath: str, baseDir: str | None = None) -> str:
    base = baseDir or os.getcwd()
    if filePath == "~/.deepagents":
        return deepAgentsHome()
    if filePath.startswith("~/.deepagents/"):
        return str(Path(deepAgentsHome()) / filePath[len("~/.deepagents/"):])
    if filePath.startswith("~/"):
        return str(Path.home() / filePath[2:])
    if Path(filePath).is_absolute():
        return filePath
    return str(Path(base) / filePath)
