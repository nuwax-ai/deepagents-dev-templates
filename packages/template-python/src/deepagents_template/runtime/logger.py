"""Structured logger — Python port of ``src/runtime/logger.ts``.

Supports log levels, context fields, JSON output mode, and optional file
tee'ing controlled by ``LOG_DIR``. Mirrors the TypeScript template's logger
shape so log lines look identical in cross-language benchmarks.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import threading
from datetime import UTC, datetime
from enum import IntEnum
from pathlib import Path
from typing import Any, ClassVar


class LogLevel(IntEnum):
    DEBUG = 0
    INFO = 1
    WARN = 2
    ERROR = 3


_LEVEL_NAMES = {
    LogLevel.DEBUG: "debug",
    LogLevel.INFO: "info",
    LogLevel.WARN: "warn",
    LogLevel.ERROR: "error",
}

_ANSI_COLORS = {
    LogLevel.DEBUG: "\033[90m",   # bright black
    LogLevel.INFO: "\033[36m",    # cyan
    LogLevel.WARN: "\033[33m",    # yellow
    LogLevel.ERROR: "\033[31m",   # red
}
_RESET = "\033[0m"


def _env_level() -> LogLevel:
    raw = os.environ.get("LOG_LEVEL", "info").strip().lower()
    return {
        "debug": LogLevel.DEBUG,
        "info": LogLevel.INFO,
        "warn": LogLevel.WARN,
        "warning": LogLevel.WARN,
        "error": LogLevel.ERROR,
    }.get(raw, LogLevel.INFO)


class Logger:
    """JSON-or-pretty logger with module-name context and optional file tee."""

    _file_lock: ClassVar[threading.Lock] = threading.Lock()
    _file_path: ClassVar[str | None] = None
    _file_handle: ClassVar[Any | None] = None

    def __init__(self, name: str, level: LogLevel | None = None) -> None:
        self.name = name
        self.level = level if level is not None else _env_level()

    def child(self, name: str) -> Logger:
        return Logger(f"{self.name}.{name}", self.level)

    # ── Output helpers ───────────────────────────────────
    def _should_emit(self, level: LogLevel) -> bool:
        return level >= self.level

    def _emit(self, level: LogLevel, msg: str, *args: Any, **fields: Any) -> None:
        if not self._should_emit(level):
            return
        # Format %-style positional args into the message — mirrors printf-like
        # usage in the TypeScript template.
        if args:
            with contextlib.suppress(Exception):
                msg = msg % args
        record = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": _LEVEL_NAMES[level],
            "logger": self.name,
            "msg": msg,
        }
        if fields:
            record.update(fields)
        line = json.dumps(record, ensure_ascii=False, default=str)
        self._write(level, line)

    def _write(self, level: LogLevel, line: str) -> None:
        # 1. Stderr
        if os.environ.get("LOG_STRUCTURED", "1") == "1":
            print(line, file=sys.stderr)
        else:
            color = _ANSI_COLORS[level]
            ts = datetime.now().strftime("%H:%M:%S")
            print(
                f"{color}{_LEVEL_NAMES[level]:<5}\033[0m "
                f"\033[2m[{ts}]\033[0m \033[1m{self.name}\033[0m — {line}",
                file=sys.stderr,
            )
        # 2. Optional file tee
        path = self._ensure_log_file()
        if path is not None:
            with self._file_lock:
                if Logger._file_handle is None or Logger._file_path != path:
                    Logger._file_handle = open(path, "a", encoding="utf-8")  # noqa: SIM115
                    Logger._file_path = path
                self._file_handle.write(line + "\n")
                self._file_handle.flush()

    @classmethod
    def _ensure_log_file(cls) -> str | None:
        log_dir = os.environ.get("LOG_DIR")
        if not log_dir:
            return None
        if cls._file_path is None:
            with cls._file_lock:
                if cls._file_path is None:
                    directory = Path(log_dir).expanduser().resolve()
                    directory.mkdir(parents=True, exist_ok=True)
                    stamp = (
                        datetime.now(UTC)
                        .isoformat(timespec="seconds")
                        .replace(":", "-")
                    )
                    cls._file_path = str(directory / f"agent-{stamp}-{os.getpid()}.jsonl")
        return cls._file_path

    # ── Public API ───────────────────────────────────────
    def debug(self, msg: str, *args: Any, **fields: Any) -> None:
        self._emit(LogLevel.DEBUG, msg, *args, **fields)

    def info(self, msg: str, *args: Any, **fields: Any) -> None:
        self._emit(LogLevel.INFO, msg, *args, **fields)

    def warn(self, msg: str, *args: Any, **fields: Any) -> None:
        self._emit(LogLevel.WARN, msg, *args, **fields)

    def warning(self, msg: str, *args: Any, **fields: Any) -> None:
        self.warn(msg, *args, **fields)

    def error(self, msg: str, *args: Any, **fields: Any) -> None:
        self._emit(LogLevel.ERROR, msg, *args, **fields)

    def exception(self, msg: str, *args: Any, **fields: Any) -> None:
        import traceback
        fields.setdefault("traceback", traceback.format_exc())
        self._emit(LogLevel.ERROR, msg, *args, **fields)


logger = Logger("deepagents")
