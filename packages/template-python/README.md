# DeepAgents Dev Templates — Python

A Python port of the TypeScript `packages/template` agent template, built on
[pydantic-ai](https://github.com/pydantic/pydantic-ai) and
[pydantic-deepagents](https://github.com/pydantic/pydantic-deepagents).

## QuickStart

```bash
uv sync
uv run deepagents-app chat
```

## Commands

| Command | Description |
|---------|-------------|
| `deepagents-app` | Start ACP server (stdio) |
| `deepagents-app chat` | Interactive REPL |
| `deepagents-app ask "..."` | One-shot prompt |
| `deepagents-app run <file>` | Run prompt from file |
| `deepagents-app graph` | Generate code graph |

## Development

```bash
uv sync --group dev
uv run pytest
uv run ruff check .
uv run pyright
uv build
```
