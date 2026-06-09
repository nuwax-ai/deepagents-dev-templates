"""Runtime layer — protected engine.

Mirrors ``packages/template/src/runtime/`` from the TypeScript template.
Modules in this package are infrastructure code and should not be modified
unless the user explicitly asks for it (see ``template.manifest.json``
``zones.protected``).
"""

from __future__ import annotations

from deepagents_template.runtime.code_graph import (
    generate_code_graph,
    write_code_graph,
)
from deepagents_template.runtime.logger import Logger, LogLevel, logger

__all__ = [
    "LogLevel",
    "Logger",
    "generate_code_graph",
    "logger",
    "write_code_graph",
]
