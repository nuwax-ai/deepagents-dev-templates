"""One-shot CLI — single prompt execution and exit."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from deepagents_template.runtime.logger import logger


def run_one_shot(prompt: str, options: Any = None) -> int:
    """Run a single prompt and print the response."""
    log = logger.child("one-shot")
    log.info("Running one-shot prompt", extra={"prompt": prompt[:100]})
    print(f"Prompt: {prompt}")
    print("Agent response: (placeholder)")
    return 0


def run_prompt_file(file_path: str, options: Any = None) -> int:
    """Read a prompt from a file and execute it."""
    log = logger.child("one-shot")
    try:
        content = Path(file_path).read_text(encoding="utf-8")
        log.info("Running prompt from file", extra={"file": file_path, "length": len(content)})
        return run_one_shot(content, options)
    except FileNotFoundError:
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Error reading file {file_path}: {exc}", file=sys.stderr)
        return 1
