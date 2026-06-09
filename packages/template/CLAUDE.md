# DeepAgents Dev Templates — Project Instructions

## Project Overview
This is a template project for building AI Agents using deepagents (JS/TS) that integrate with nuwaclaw via ACP protocol.

## Architecture Rules
- `src/runtime/` (engine) and `src/surfaces/` (ACP/CLI entry) are PROTECTED — do not modify unless explicitly asked
- `src/app/` is the business logic zone — AI and user can freely modify
- Prompts for the target agent come ONLY from ACP — never hardcode them
- When the AI needs a tool, ALWAYS check platform plugins first (MCP), then built-in tools, then write custom code as last resort
- When a custom tool needs an API key or config value, create an agent variable — don't hardcode secrets

## Tech Stack
- **Runtime**: deepagents (LangGraph-based agent harness for JS/TS)
- **ACP**: deepagents-acp (Agent Client Protocol server)
- **Language**: TypeScript (strict mode, ES2022)
- **Validation**: Zod schemas
- **Package Manager**: npm

## Code Conventions
- Use ES modules (import/export), not CommonJS (require)
- All files use `.ts` extension
- Tool files follow `{name}.tool.ts` naming convention
- Skills use `SKILL.md` with YAML frontmatter
- Config files are JSON with JSONC comments allowed
- Use structured logging via `src/runtime/logger.ts`

## Testing
- Framework: vitest
- Unit tests: `tests/unit/`
- ACP smoke tests: `tests/acp-smoke/`
- Integration tests: `tests/integration/`
- Run with: `npm test`

## Build & Run
- `npm run build` — compile to dist/
- `npm run dev` — development mode with tsx
- `npm start` — production mode from dist/
- `npm run start:acp` — start ACP server explicitly
- `npm run inspect` — inspect the agent orchestration spec (dry-run)
- `npm run inspect -- --full` — full inspection with LangGraph runtime topology (requires model credentials)
