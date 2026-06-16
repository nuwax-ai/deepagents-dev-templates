# Python Template Package Plan

## Status: LangGraph Migration Complete

### Phase 1: Initial Package ✓
- [x] Package initialization (uv init, pyproject.toml)
- [x] Source structure (src/deepagents_app_py/)
- [x] Runtime modules (config, middleware, platform, storage)
- [x] Surfaces (ACP server, CLI REPL, one-shot)
- [x] App tools (HTTP, variables, memory, etc.)
- [x] Prompts and skills
- [x] Config files
- [x] Scripts (build, package, dev)
- [x] Tests (unit, smoke)
- [x] Manifests (template, agent-package)
- [x] Root-level docs and config files

### Phase 2: LangGraph + deepagents Migration ✓
- [x] Replace pydantic-ai with LangGraph + deepagents
- [x] Port app tools to LangChain `@tool` decorators
- [x] Rebuild runtime engine on LangGraph state graphs
- [x] ACP server on deepagents-acp (stdio transport)
- [x] CLI surfaces (REPL + one-shot) on LangGraph
- [x] Retire deepagents-acp-py standalone library
- [x] Drop pydantic-ai dependencies
- [x] Update dev-agent skills for LangGraph

### Phase 3: Documentation Sync ✓
- [x] README.md — full architecture docs
- [x] QUICKSTART.md — usage guide with examples
- [x] CLAUDE.md — project conventions and patterns
- [x] PLAN.md — status tracking

### Remaining / Future
- [ ] Full functional parity with TS template
- [ ] Sub-agent integration (discover_sub_agents → create_deep_agent subagents param)
- [ ] ACP MCP forwarding (client's MCP servers → per-session graph rebuild)
- [ ] More built-in skills (debugging, code-review, etc.)
- [ ] Integration tests for ACP surface
- [ ] MkDocs documentation site
