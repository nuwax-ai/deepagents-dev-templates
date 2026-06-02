# nuwaclaw Engine Integration

This document defines the V1 contract for installing and launching this template as a nuwaclaw agent engine.

## Package Contract

The engine package is described by `agent-package.json`.

Required fields:

| Field | Purpose |
|---|---|
| `engine` | Stable engine id. Current value: `deepagents-app`. |
| `source` | Default install source. V1 supports npm. |
| `alternativeSources` | Private/offline install options. V1 supports `.tgz` and git refs. |
| `bin.start` | ACP stdio entrypoint. Current value: `dist/index.js`. |
| `bin.graph` | Code graph command. Current value: `dist/index.js graph`. |
| `graph.schema` | Graph schema id. Current value: `nuwaclaw.agent-code-graph.v1`. |
| `env` | Runtime variables that nuwaclaw can ask the user/platform to provide. |

The release script writes `agent-package.release.json` with the `.tgz` source and SHA256 checksum. Source `agent-package.json` keeps checksum empty because the tarball is generated later.

## Launch Contract

nuwaclaw launches the engine as a stdio ACP server:

```bash
node dist/index.js
```

The process writes ACP JSON-RPC to stdout. Runtime logs must go to stderr.

## Startup Config

V1 uses startup-level config because `deepagents-acp` does not currently expose a generic per-session metadata hook.

nuwaclaw passes config through `ACP_SESSION_CONFIG_JSON`:

```json
{
  "model": "claude-sonnet-4-6",
  "agentId": "agent-id",
  "spaceId": "space-id",
  "systemPrompt": "Prompt supplied by ACP/platform",
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

Priority:

```text
ACP_SESSION_CONFIG_JSON > environment variables > config/app-agent.config.json > defaults
```

## Prompt Contract

The target application Agent prompt comes from ACP/platform startup config. The runtime must not hardcode target prompts.

When the developer Agent drafts or revises a target prompt, it calls:

```json
{
  "operation": "save_prompt",
  "prompt": "...",
  "metadata": {
    "source": "ai-generated"
  }
}
```

through the `platform_api` tool.

## MCP Contract

The runtime merges MCP servers through `MCPManager`.

Default priority:

```text
ACP_SESSION_CONFIG_JSON.mcpServers > platform-bound MCP components > config/mcp.default.json
```

Platform-bound MCP components are read through `PlatformClient.listComponents()` during ACP/CLI startup when `PLATFORM_AGENT_ID` and `PLATFORM_SPACE_ID` are present.

Supported platform payload examples:

```json
{ "type": "mcp", "config": { "name": "weather", "command": "node", "args": ["weather-mcp.js"] } }
```

```json
{ "config": { "mcpServer": { "url": "https://mcp.example.com/sse" } } }
```

```json
{ "config": { "mcp": { "servers": { "docs": { "command": "npx", "args": ["-y", "docs-mcp"] } } } } }
```

## Debug Contract

The developer Agent can create and inspect debug sessions through `platform_api`:

```json
{ "operation": "create_debug_session", "model": "claude-sonnet-4-6" }
```

```json
{ "operation": "get_debug_session", "sessionId": "debug-session-id" }
```

The intended full flow is:

```text
nuwaclaw UI -> launch ACP engine -> pass prompt/model/MCP config -> developer Agent writes app Agent -> platform_api creates debug session -> nuwaclaw invokes the same ACP path for debugging
```

## Code Graph Contract

nuwaclaw can request the generated code relationship graph with:

```bash
node dist/index.js graph
```

The output schema is `nuwaclaw.agent-code-graph.v1`. It includes runtime, app tools, prompts, skills, config, manifests, and packaging scripts.

## Current Verification

Local verification covers:

- TypeScript compile and typecheck.
- Unit tests for config, platform client, MCP merge/hydration, tools, variables, and graph generation.
- ACP stdio smoke test using the official ACP TypeScript SDK for `initialize` and `session/new`.
- `.tgz` packaging with SHA256 release manifest.

Still requires live environment verification:

- Real nuwaclaw UI launch with startup prompt/debug config.
- Real Nuwax production endpoint validation for component list, prompt save, and debug sessions.
