# DeepAgents Inspector

Read + write orchestration inspector for DeepAgents template workspaces.

## What is this?

The inspector reads a DeepAgents template app and produces an `AgentOrchestrationSpec` — a structured JSON snapshot of the agent's configuration and compiled topology. Use it to:

- Audit the middleware chain order, enabled states, and config values
- Verify which tools, skills, subagents, and memory files are active
- See the real LangGraph node/edge topology (`--full` mode)
- Share an agent's structure as a single JSON file or Mermaid diagram

Phase 1 is **read-only** for the dry-run inspection path. The browser UI now also
ships an **editing** panel that writes back to the same `app-agent.config.json`
and text files (system prompt, `SKILL.md`, `AGENT.md`). See
[`docs/editing.md`](./docs/editing.md) for the supported field list, the
`/api/preview` / `/api/apply` / `/api/text` endpoints, and the protection model.

## Usage

```bash
# Dry-run (default) — no model credentials needed
npm run inspect -w packages/inspector -- --out /tmp/spec.json --no-open

# Full mode — real agent + LangGraph topology (requires API key)
npm run inspect -w packages/inspector -- --full --out /tmp/spec-full.json --no-open

# Launch the browser UI
npm run inspect -w packages/inspector
```

## CLI

```
deepagents-inspect [flags]

  --config <path>          config file (default: ./config/app-agent.config.json)
  --workspace <path>       workspace root (default: cwd)
  --out <path>             write spec to file and exit (skip server)
  --format json|mermaid    output format with --out (default: json)
  --port <n>               local UI port (default: 7322)
  --no-open                print URL without opening a browser
  --full                   instantiate the real agent and include LangGraph topology
  --xray <bool|number>     graph xray depth for --full (default: 1)
  --help, -h               show help
```

## Browser UI

The local UI (`http://localhost:7322`) has four tabs:

- **Graph** — React Flow canvas showing the compiled LangGraph nodes and edges (`--full` only)
- **Pipeline** — ordered middleware chain with enabled/disabled states
- **Resources** — tools, skills, subagents, and memory files
- **JSON** — the raw `AgentOrchestrationSpec` as a fallback

## Project Structure

```
src/
├── cli/inspect.ts        # CLI entry point and flag parsing
├── inspector.ts           # inspectAgent(), writeOrchestrationSpec()
├── projection.ts          # Pure transformers (model, tools, middleware, etc.)
├── graph-introspect.ts    # Defensive LangGraph introspection adapter
├── template-runtime.ts    # Dual-channel import (source or compiled)
├── server.ts              # Static file server + /api/spec endpoint
├── types.ts               # AgentOrchestrationSpec types
└── index.ts               # Barrel export

web/graph-ui/              # React Flow browser UI (CDN, no build step)
tests/                     # vitest unit tests
```

## Development

```bash
npm install
npm run build
npm test
```

Set `INSPECTOR_TEMPLATE_SOURCE=1` to import template runtime from source during development — no need to rebuild template first.

## Documentation

See [docs/inspect.md](./docs/inspect.md) for the spec format reference, example output, and troubleshooting.
