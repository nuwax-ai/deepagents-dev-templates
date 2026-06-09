"""CLI surface — interactive REPL and one-shot modes."""
from __future__ import annotations

from deepagents_template.surfaces.cli.extract_content import extract_content
from deepagents_template.surfaces.cli.one_shot import run_one_shot, run_prompt_file
from deepagents_template.surfaces.cli.repl import start_repl

__all__ = ["extract_content", "run_one_shot", "run_prompt_file", "start_repl"]
