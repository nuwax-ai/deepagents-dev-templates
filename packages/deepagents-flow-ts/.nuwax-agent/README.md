# .nuwax-agent Development Configuration

This directory stores Nuwax-specific development, capability-layer, packaging, and lifecycle metadata for the **deepagents-flow-ts** workflow-orchestration template agent.

It is intentionally separate from `config/`:

- `config/` is runtime application configuration consumed by `loadFlowConfig` → `loadConfig` (app-ts).
- `.nuwax-agent/` is platform-facing metadata used by the Nuwax configuration panel, packaging, install/upgrade flows, and the `flow capabilities` CLI.

No real secrets live here — use placeholders like `${SECRET_ANTHROPIC_API_KEY}` and let ACP / env / installer provide the final value.

## Capability Source Layers

| Layer | Examples | Ownership |
| --- | --- | --- |
| ACP dynamic | System prompt, MCP servers, skills, model, subagents | Nuwax platform & workspace config |
| Agent builtin | Runtime tools (bash/fs/search/http/mcp-bridge), compaction, demo tools | Template package |
| Environment builtin | API keys, base URLs, log paths | Cloud computer / local machine / installer |
| Agent builtin file | Session store (file JSON checkpointer) | Template package (`.flow-sessions/`) |
| Package placeholder | `${INSTALL_ROOT}`, `${AGENT_ID}`, `${PACKAGE_VERSION}` | Build & install pipeline |

## Files

- `capability-sources.json` — maps every capability to its source layer (acp-dynamic / agent-builtin / env-builtin / agent-builtin-file / package-placeholder). This is the contract the panel and `flow capabilities` read.
- `panel.config.json` — describes which fields the platform panel can manage (model / prompt / mcpServers / skills / subagents / sandbox) vs. the non-editable builtin capabilities.

## How the running agent consumes each layer

- **systemPrompt** — `resolveSystemPrompt(appConfig, sessionConfig, root)` priority: ACP session > `config.agent.systemPrompt` > `prompts/flow.base.md` > inline fallback.
- **mcpServers** — `MCPManager` merges `config/mcp.default.json` < platform-bound MCP < ACP/session MCP (`mergeStrategy: session-wins`); native tools loaded via `loadMcpTools`.
- **model** — `resolveModel(appConfig)` from `config.model` (ACP session / env / config / defaults).
- **skills** — `resolveSkillsPaths(appConfig)` discovers `skills/builtin/`, `skills/platform/`, and `.agents/*/skills/`.
- **subagents** — `discoverSubAgents(appConfig)` parses `.agents/agents/<name>/AGENT.md`.
- **sessionStore** — `FileCheckpointSaver` (extends `MemorySaver`) persists to `config.memory.dir` (`.flow-sessions/`); thread-isolated, survives restart, restores interrupt/resume.
- **builtInTools** — `createFlowTools(ctx)` composes bash/fs/search/http/json/mcp-bridge/platform_api/agent_variable + demo tools; bound to the model via `bindTools` and executed by `ToolNode`.

Query it at runtime: `deepagents-flow-ts capabilities` (no credentials needed).
