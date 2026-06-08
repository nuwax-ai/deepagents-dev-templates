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

## Roadmap Documents

- [Agent core progress](./docs/agent-core-progress.md) tracks supported, planned, blocked, and deferred agent-core capabilities.
- [Scenario agent template design](./docs/scenario-agent-template-design.md) describes how user prompts become Agent Specs, prompts, tools, skills, variables, and `.nuwax-agent` panel/debug configuration.
- [Scenario agent examples](./docs/scenario-agent-examples.md) provides concrete user-prompt-to-Agent-Spec examples for support, sales, data, document QA, code maintenance, and operations Agents.
- [Package install lifecycle](./docs/package-install-lifecycle.md) records the planned npm `.tgz`, Nuwax `.tar.gz`, Nuwax `.zip`, version/platform JSON, install, upgrade, rollback, and uninstall flow.

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
- Real model config supports OpenAI-compatible (`LLM_PROVIDER=openai`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`) and Anthropic-compatible (`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`) settings
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

Current distribution supports npm, `.tgz`, Git URL, and local Nuwax `.tar.gz`
/ `.zip` artifacts with version/platform JSON, checksums, and local
install/upgrade/rollback/uninstall scripts; see
[docs/package-install-lifecycle.md](./docs/package-install-lifecycle.md).

Generated release artifacts:

- `deepagents-dev-templates-<version>.tgz`
- `dist-packages/deepagents-dev-templates-<version>-nuwax.tar.gz`
- `dist-packages/deepagents-dev-templates-<version>-nuwax.zip`
- `agent-package.release.json`
- `dist-packages/package-checksums.json`

## Capabilities

See [docs/template-capabilities.md](./docs/template-capabilities.md) for the default tools, default skills, config-delivered capabilities, and the `/Users/apple/workspace/pydantic-deepagents` reference evaluation.

See [docs/nuwaclaw-engine-integration.md](./docs/nuwaclaw-engine-integration.md) for the engine package, ACP launch, startup config, debug, MCP hydration, and graph contracts expected by nuwaclaw.

See [docs/zed-acp-setup.md](./docs/zed-acp-setup.md) for the Zed `agent_servers` configuration template and authentication notes.

See [docs/rcoder-cloud-debug.md](./docs/rcoder-cloud-debug.md) for packaged rcoder cloud-computer debugging with bundled `node_modules` and chat-delivered ACP config.

See [docs/scenario-agent-template-design.md](./docs/scenario-agent-template-design.md) for `.nuwax-agent`, OpenAI-compatible debug profiles, capability source layering, and example scenario Agent generation.

See [docs/scenario-agent-examples.md](./docs/scenario-agent-examples.md) for concrete scenario Agent generation examples.

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
| `npm run inspect` | Inspect the agent orchestration spec (dry-run) |
| `npm run inspect -- --full` | Full inspection with LangGraph runtime topology |
