# DeepAgents Dev Templates

Monorepo for building, inspecting, and distributing DeepAgents AI applications.

## Packages

| Package | Description |
|---|---|
| [`packages/deepagents-app-ts`](./packages/deepagents-app-ts/) | TypeScript application template — ACP server, tools, skills, config, distribution |
| [`packages/deepagents-app-py`](./packages/deepagents-app-py/) | Python application template — LangGraph + deepagents, ACP server, REPL |
| [`packages/inspector`](./packages/inspector/) | Orchestration visualizer — inspect agent structure, middleware chain, and LangGraph topology |
| [`packages/dev-agent`](./packages/dev-agent/) | Developer agent config and skills |

## Quick Start

```bash
# Install dependencies (requires pnpm 9+)
pnpm install

# Build TypeScript template
pnpm --filter deepagents-app-ts build

# Build Python template (requires uv)
cd packages/deepagents-app-py && uv sync
```

## Scripts

| Command | Description |
|---|---|
| `pnpm build` | Build TypeScript template |
| `pnpm test` | Run TypeScript template tests |
| `pnpm graph` | Generate code relationship graph |
| `pnpm inspect` | Inspect agent orchestration (dry-run by default) |
| `pnpm inspect -- --full` | Full inspection with LangGraph runtime topology |

## Development

```bash
# TypeScript template
pnpm --filter deepagents-app-ts dev    # Development mode
pnpm --filter deepagents-app-ts test   # Run tests
pnpm --filter deepagents-app-ts lint   # Lint code

# Python template
cd packages/deepagents-app-py
uv run deepagents-app-py chat          # Interactive REPL
uv run pytest                          # Run tests
uv run ruff check .                    # Lint code
```

## License

MIT

## Development Docs

各包模板内的 `README` / `QUICKSTART` / `docs/guides` 面向模板使用者。Monorepo 维护用的开发计划、进度看板、研究报告等见 [docs/packages/](docs/packages/README.md)。
