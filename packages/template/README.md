# DeepAgents Dev Templates

> A development environment template for building AI Agents using [deepagents](https://github.com/langchain-ai/deepagents) that integrate with nuwaclaw via ACP protocol.

## Architecture

```
src/runtime/     — Protected infrastructure (ACP server, platform client, config)
src/app/         — Business logic (tools, subagents, hooks) — AI & user editable
prompts/         — System prompt templates
skills/          — Progressive-loading skills (builtin + platform)
config/          — Model, MCP, variables, permissions
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your model/API settings

# Development mode
npm run dev

# Build for production
npm run build
npm start

# Run tests
npm test
```

## Key Concepts

### Tool Selection Priority
1. **Platform MCP Tools** — configured plugins from Nuwax platform
2. **Built-in Custom Tools** — http_request, platform_api, agent_variable, mcp_tool_bridge, json_utils
3. **deepagents Built-in Tools** — filesystem, execute, task, write_todos
4. **Write Custom Code** — only if no existing tool fits

### Prompt Source
- Target agent prompts come **only from ACP** (never hardcoded)
- AI-generated prompts are saved to platform via API
- Developer agent prompt is in `prompts/developer-agent.system.md`

### Runtime Configuration
- ACP/platform startup config can be supplied through `ACP_SESSION_CONFIG_JSON`
- Real model config supports `ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_AUTH_TOKEN`
- Platform endpoints are configurable through `config/platform.json`
- Platform-bound MCP components are hydrated into the MCP manager during ACP/CLI startup when platform credentials are present
- Default Context7 MCP is configured in `config/mcp.default.json`
- Generated code node relationships are available through `npm run graph`

### Editable Zones
- **Protected** (`src/runtime/`): Infrastructure code — do not modify
- **AI-editable** (`src/app/`, `prompts/`, `skills/`): AI and user can modify
- **User-editable** (`config/`): User and platform configure

## Distribution

Package the agent for nuwaclaw using `agent-package.json`:

```bash
npm run package
```

Supports distribution via npm, .tgz, or Git URL.

Generated release artifacts:

- `deepagents-dev-templates-0.1.0.tgz`
- `agent-package.release.json`

## Capabilities

See [docs/template-capabilities.md](./docs/template-capabilities.md) for the default tools, default skills, config-delivered capabilities, and the `/Users/apple/workspace/pydantic-deepagents` reference evaluation.

See [docs/nuwaclaw-engine-integration.md](./docs/nuwaclaw-engine-integration.md) for the engine package, ACP launch, startup config, debug, MCP hydration, and graph contracts expected by nuwaclaw.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start in development mode |
| `npm run build` | Compile TypeScript |
| `npm start` | Start ACP server (production) |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:acp-smoke` | Run ACP protocol smoke tests |
| `npm run lint` | Lint source code |
| `npm run typecheck` | Type check without emit |
| `npm run graph` | Print the code node relationship graph JSON |
