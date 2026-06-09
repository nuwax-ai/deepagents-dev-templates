# DeepAgents Dev Templates — Python Template

## Structure
- `src/deepagents_template/` — Package source
  - `runtime/` — Protected engine (config, middleware, platform, storage)
  - `app/` — AI-editable business tools and hooks
  - `surfaces/` — ACP server and CLI entrypoints
- `prompts/` — System prompt files
- `skills/` — Skill definitions
- `config/` — JSON configuration files
- `scripts/` — Development and packaging scripts
- `tests/` — Test suite

## Commands
- Dev: `uv sync --group dev`
- Test: `uv run pytest`
- Lint: `uv run ruff check .`
- Type-check: `uv run pyright`
- Build: `uv build`
- Run: `uv run deepagents-app chat`
