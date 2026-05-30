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
# Edit .env with your API keys

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
2. **Built-in Custom Tools** — http_request, platform_api, agent_variable
3. **deepagents Built-in Tools** — filesystem, execute, task, write_todos
4. **Write Custom Code** — only if no existing tool fits

### Prompt Source
- Target agent prompts come **only from ACP** (never hardcoded)
- AI-generated prompts are saved to platform via API
- Developer agent prompt is in `prompts/developer-agent.system.md`

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
