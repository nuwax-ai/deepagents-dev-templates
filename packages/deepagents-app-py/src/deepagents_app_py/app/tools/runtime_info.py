"""Runtime info tool — returns runtime configuration and environment info."""

from __future__ import annotations

import os
import platform
import sys

from langchain_core.tools import tool


@tool
def runtime_info() -> str:
    """Return runtime configuration and environment information (cwd, Python, platform, provider)."""
    info = {
        "cwd": os.getcwd(),
        "working_dir": os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd()),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "provider": os.environ.get("LLM_PROVIDER", "(unset)"),
    }
    return "\n".join(f"{k}: {v}" for k, v in info.items())
