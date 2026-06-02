# Template Capabilities

This template is for a development Agent that helps users and AI Agents build scenario-specific application Agents. The generated application Agent runs through ACP and is packaged for nuwaclaw as an agent engine.

## Runtime Contract

- Framework: DeepAgents JS on LangGraph.
- ACP entry: `deepagents-acp` stdio server.
- Stdio rule: runtime logs are written to stderr so stdout stays valid ACP JSON-RPC.
- Primary generated code area: `src/app/`, `prompts/`, `skills/`, and `config/`.
- Protected infrastructure: `src/runtime/`.
- Prompt source rule: target Agent prompts come from ACP/platform session config. When the AI writes or revises a target prompt, it saves that prompt through `platform_api.save_prompt`.
- Tool source rule: when the Agent needs an external capability, it checks platform components/MCP first, then built-in template tools, then DeepAgents built-ins, and only then writes custom code.

## Default Tools

These tools are built into every generated Agent runtime.

| Tool | Source | Purpose |
|---|---|---|
| `platform_api` | `src/app/tools/platform-api.tool.ts` | Save prompts, query platform components, bind components, execute plugins/workflows, create and read debug sessions. |
| `agent_variable` | `src/app/tools/agent-variable.tool.ts` | Create and read Agent variables. Use this when custom code needs API keys or user-provided configuration. |
| `mcp_tool_bridge` | `src/app/tools/mcp-bridge.tool.ts` | List configured MCP servers and call command-based MCP tools such as Context7. |
| `http_request` | `src/app/tools/http-request.tool.ts` | Make HTTP calls for simple API integration and validation. |
| `json_utils` | `src/app/tools/json-utils.tool.ts` | Parse, validate, extract, and merge JSON payloads. |
| DeepAgents filesystem tools | DeepAgents | Read/write/edit files in the workspace with template permissions. |
| DeepAgents execution/task tools | DeepAgents | Run shell commands with approval and delegate complex subtasks. |

## Default Skills

Built-in development skills:

- `build-and-compile`
- `code-review`
- `environment-discovery`
- `git-workflow`
- `refactor`
- `skill-creator`
- `systematic-debugging`
- `test-writer`
- `verification-strategy`

Platform-oriented skills:

- `acp-debugging`
- `agent-package-release`
- `agent-variable-design`
- `mcp-integration`
- `platform-capability-discovery`
- `platform-tool-selection`

## Config-Delivered Capabilities

These capabilities are designed to be delivered by nuwaclaw or the Nuwax platform without changing template source code.

| Capability | Config Surface | Notes |
|---|---|---|
| Model selection | `ACP_SESSION_CONFIG_JSON.model`, `ANTHROPIC_MODEL`, `config/app-agent.config.json.model` | Priority is ACP/session > env > config file > defaults. |
| Anthropic proxy/base URL | `ANTHROPIC_BASE_URL` or `model.baseUrl` | Used by the LangChain `ChatAnthropic` model instance. |
| Auth | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `PLATFORM_API_TOKEN` | `.env` is ignored and not packaged. |
| Target prompt | `ACP_SESSION_CONFIG_JSON.systemPrompt` | This is the highest-priority prompt source for ACP startup. |
| Platform identity | `PLATFORM_AGENT_ID`, `PLATFORM_SPACE_ID`, session config | Enables platform-bound tools. |
| MCP servers | `config/mcp.default.json`, platform-bound MCP components, `ACP_SESSION_CONFIG_JSON.mcpServers` | Default includes Context7. Runtime startup hydrates bound platform MCP components when platform credentials are present. Session config can override or add servers. |
| Platform endpoint map | `config/platform.json`, `config.platform.endpoints` | Keeps Nuwax API path changes out of source code. |
| Skills | `config.skills.directories` | Lets the platform or project add skill directories. |
| Permissions | `config.permissions` | Protects runtime code while allowing app/prompt/skill/config changes. |
| Distribution source | `agent-package.json.source`, `alternativeSources` | Supports npm, local/private `.tgz`, and git refs. |
| Code graph | `node dist/index.js graph` or `npm run graph` | Emits `nuwaclaw.agent-code-graph.v1` for generated-code node relationship UI. |

## Code Node Relationship Graph

The graph command lets nuwaclaw render the generated Agent project structure without parsing TypeScript itself.

```bash
npm run graph
node dist/index.js graph .nuwaclaw-code-graph.json
```

The graph includes entrypoints, runtime modules, custom tools, skills, prompts, config files, manifests, packaging scripts, and their relationships.

## Platform MCP Hydration

When `PLATFORM_AGENT_ID` and `PLATFORM_SPACE_ID` are available, ACP/CLI startup reads bound platform components through `PlatformClient.listComponents()` and normalizes MCP components into the runtime `MCPManager` platform layer.

Supported component payload shapes:

```json
{ "type": "mcp", "config": { "name": "weather", "command": "node", "args": ["weather-mcp.js"] } }
```

```json
{ "config": { "mcpServer": { "url": "https://mcp.example.com/sse" } } }
```

```json
{ "config": { "mcp": { "servers": { "docs": { "command": "npx", "args": ["-y", "docs-mcp"] } } } } }
```

The merge order still follows `config.mcp.mergeStrategy`; the default is `session-wins`, so nuwaclaw startup MCP config overrides platform-bound MCP config, which overrides default MCP config.

## pydantic-deepagents Reference

The local `/Users/apple/workspace/pydantic-deepagents` project influenced these parts of the template:

- Declarative agent spec/config instead of hardcoded runtime behavior.
- Clear split between runtime harness and app-specific tools/skills.
- ACP bridge as a normal runtime entry rather than a special one-off script.
- CLI/env/config precedence model.
- Progressive skills as separate files loaded only when relevant.
- Memory/context files as project-level guidance.
- Variable handling for secrets and user-provided values.

This template does not copy Python implementation details. The V1 target is JS/TS, with Python support left as a future runtime sibling.

## Known Boundary

`deepagents-acp` currently exposes static agent configuration at server construction time. It supports selecting an agent by `session/new.configOptions.agent`, but does not expose a general per-session metadata hook. This template therefore supports startup-level ACP session injection through `ACP_SESSION_CONFIG_JSON` and exports `buildACPAgentConfig()` / `buildACPAgentConfigAsync()` for nuwaclaw or a future ACP server wrapper to call when a richer session hook exists.

The included ACP smoke test verifies stdio `initialize` and `session/new` using the official ACP TypeScript SDK without invoking the LLM. A full nuwaclaw UI prompt/debug run still requires a live nuwaclaw client and platform environment.
