"""Task tool — delegate a task to a specialized subagent and return the result."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool


@tool
async def task(
    prompt: str,
    subagent: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> str:
    """Delegate a task to a specialized subagent and return the result.

    Use this to break complex work into focused subtasks:
    - Specify a `subagent` name (discovered from .agents/agents/<name>/AGENT.md)
      for a pre-configured specialist
    - Or provide a `system_prompt` directly to create an ad-hoc specialist inline

    The subagent runs in isolation (LLM-only, no tool access) and returns a text result.
    Best for research, analysis, summarization, drafting, and pure-reasoning tasks.

    Examples:
      task(subagent="researcher", prompt="Find the rate limit docs for the GitHub API")
      task(system_prompt="You are a security reviewer. Check for OWASP top-10 only.",
           prompt="<code here>")
      task(prompt="Summarize key decisions from this architecture document: <doc>")

    Args:
        prompt: The task to delegate to the subagent.
        subagent: Name of a discovered subagent from .agents/agents/<name>/AGENT.md.
        system_prompt: Ad-hoc system prompt for an inline specialist — use when no
            pre-defined subagent fits.
    """
    # Lazy imports to avoid circular dependencies at module load time.
    from deepagents import create_deep_agent  # type: ignore[import]

    from deepagents_app_py.runtime.config.config_loader import loadConfig
    from deepagents_app_py.runtime.discovery import discover_sub_agents
    from deepagents_app_py.runtime.logger import logger
    from deepagents_app_py.runtime.model import resolve_model

    log = logger.child("task-tool")
    workspace_root = Path(os.environ.get("DEEPAGENTS_WORKING_DIR", os.getcwd()))

    # Resolve system prompt
    resolved_system_prompt = system_prompt
    if not resolved_system_prompt and subagent:
        subs = discover_sub_agents(workspace_root)
        found = next((s for s in subs if s.name == subagent), None)
        if not found:
            available = ", ".join(s.name for s in subs)
            return (
                f'Subagent "{subagent}" not found. '
                f"Available: {available or 'none — define subagents in .agents/agents/*/AGENT.md'}"
            )
        resolved_system_prompt = found.config.get("body", "")
        log.info("Delegating to discovered subagent", subagent=subagent)
    elif resolved_system_prompt:
        log.info("Delegating to ad-hoc subagent")
    else:
        log.info("Delegating to default assistant")

    if not resolved_system_prompt:
        resolved_system_prompt = (
            "You are a helpful assistant. Complete the given task thoroughly and concisely."
        )

    # Build a minimal agent (LLM-only, no tools) for isolation.
    # checkpointer=None avoids MemorySaver.put errors when no thread_id is provided.
    config = loadConfig({"workspaceRoot": str(workspace_root)})
    model = resolve_model(config)
    agent = create_deep_agent(
        model=model,
        system_prompt=resolved_system_prompt,
        tools=[],
        checkpointer=None,
    )

    try:
        result = await agent.ainvoke({"messages": [{"role": "human", "content": prompt}]})
    except Exception as exc:  # noqa: BLE001
        log.error("Subagent execution failed", error=str(exc))
        return f"Subagent execution failed: {exc}"

    messages = result.get("messages", [])
    last_ai = next(
        (m for m in reversed(messages) if getattr(m, "type", None) == "ai"),
        None,
    )
    if last_ai is None:
        return "[No response from subagent]"

    content = last_ai.content
    if isinstance(content, str):
        return content.strip() or "[Empty response]"
    if isinstance(content, list):
        return (
            "\n".join(
                c if isinstance(c, str) else c.get("text", "") if isinstance(c, dict) else ""
                for c in content
            ).strip()
            or "[Empty response]"
        )
    return "[No text response from subagent]"
