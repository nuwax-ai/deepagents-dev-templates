# DeepAgents Inspector

Read-only orchestration inspector for this DeepAgents template workspace.

```bash
npm run inspect -w packages/inspector -- --out /tmp/spec.json --no-open
npm run inspect -w packages/inspector -- --no-open
```

Dry-run is the default and does not create a model client or compile LangGraph. Use `--full` when you want the runtime topology:

```bash
npm run inspect -w packages/inspector -- --full --out /tmp/spec-full.json --no-open
```

Full mode may require `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `OPENAI_API_KEY`.

## CLI

```text
deepagents-inspect [flags]
  --config <path>
  --workspace <path>
  --out <path>
  --format json|mermaid
  --port <n>
  --no-open
  --full
  --xray <bool|number>
```

The local UI serves the generated spec from memory and never writes back to the agent config.
