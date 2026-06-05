# Inspecting DeepAgents Orchestration

The inspector produces an `AgentOrchestrationSpec` with the agent metadata, resolved prompt, tools, middleware, permissions, memory files, skills, subagents, and optional LangGraph topology.

Dry-run mode reads config and runtime metadata only. It is meant for quick audits and works without model credentials.

Full mode calls the template runtime factory, creates the real agent, and asks the compiled graph for a drawable topology. If the LangGraph API shape changes, graph-specific failures become warnings instead of failing the whole spec.

The browser UI is read-only:

- Graph shows the runtime topology when available.
- Pipeline shows middleware order and enabled states.
- Resources lists tools, skills, subagents, and memory files.
- JSON always exposes the raw spec as a fallback.
