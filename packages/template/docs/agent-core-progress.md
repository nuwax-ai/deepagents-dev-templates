# Agent Core Progress

This document is the canonical progress tracker for the agent core in
`packages/template`. It records what is supported today, what is planned, and
what remains blocked by platform or protocol dependencies.

## Status Legend

| Status | Meaning |
|---|---|
| Supported | Implemented and covered by local tests, ACP smoke tests, or real Zed integration. |
| Planned | Accepted as part of the roadmap, but not implemented yet. |
| Blocked | Requires external credentials, platform support, or upstream protocol/runtime support. |
| Deferred | Deliberately out of scope for the current template generation. |

## Current Summary

| Dimension | Current Level | Notes |
|---|---:|---|
| DeepAgents template runtime | 85% | Runtime, tools, skills, ACP entry, config, and tests are in place. |
| Product-grade agent core | 70% | Harness lifecycle, durable sessions, sandbox profiles, and auth/logout remain planned. |
| Nuwax/Zed integration | Supported | Real Zed ACP launch, streaming, tool calls, and permissions have been validated. |
| Distribution lifecycle | Supported locally | npm tgz, Nuwax tar/zip, version/platform JSON, checksums, local install, upgrade, rollback, and uninstall scripts exist; platform production installer validation remains planned. |

## Progress Table

| Priority | Area | Capability | Status | Evidence | Next Step |
|---|---|---|---|---|---|
| P0 | Runtime Core | DeepAgents runtime creation | Supported | `src/runtime/agent-factory.ts`, build/test pass | Keep aligned with deepagents upgrades. |
| P0 | Runtime Core | Model config for Anthropic and OpenAI-compatible providers | Supported | `config-loader.ts`, `helpers.ts`, provider tests | Prefer OpenAI-compatible in `.nuwax-agent` debug profiles. |
| P0 | Runtime Core | Middleware chain for reminders, cost, compaction, eviction, protected paths | Supported | Unit tests for compaction, eviction, permissions | Add lifecycle-level tests when harness semantics land. |
| P0 | Runtime Core | Built-in skills and platform skills | Supported | `skills/builtin/`, `skills/platform/` | Keep scenario generation skill aligned with prompt template. |
| P0 | ACP Client Core | ACP stdio startup | Supported | ACP smoke test and real Zed integration | Keep smoke test LLM-free. |
| P0 | ACP Client Core | Zed initialize/session/new/prompt streaming | Supported | Real Zed integration | Keep Zed docs current. |
| P0 | ACP Client Core | Tool call streaming and permission prompts | Supported | Real Zed integration, protected path tests | Track upstream `deepagents-acp` changes. |
| P0 | ACP Client Core | Cancel handling and stale session recovery | Supported | ACP integration verification | Convert private patches to stable adapters when upstream supports them. |
| P0 | Workspace + Safety | Editable zone separation | Supported | `template.manifest.json`, prompt rules, permission middleware | Keep `src/runtime/` protected by default. |
| P0 | Workspace + Safety | Protected path denial for runtime files | Supported | `protected-paths` tests | Keep deny checks independent of ACP internals. |
| P1 | Context + Memory | Runtime storage, messages, plan, todos, checkpoints | Supported | `runtime-storage.ts`, unit tests | Add migration docs for platform install layout. |
| P1 | Context + Memory | Conversation history, memory, checkpoint tools | Supported | Tool registry and unit tests | Add scenario examples using these tools. |
| P1 | Context + Memory | Compaction and large output eviction | Supported | Unit tests and integration notes | Add end-to-end long-session scenario later. |
| P0 | Tooling + Integration | Built-in custom tools | Supported | `src/app/tools/` and tests | Keep tool descriptions scenario-agent friendly. |
| P0 | Tooling + Integration | MCP config merge and platform MCP hydration | Supported | `mcp-manager` tests and startup path, `.nuwax-agent/capability-sources.json` | Keep ACP dynamic vs builtin boundaries in sync with panel config. |
| P1 | Tooling + Integration | Platform API prompt save, component list, debug sessions | Supported locally | Unit tests with mocked platform client | Validate production endpoints with platform credentials. |
| P1 | Distribution + Observability | npm/tgz and Nuwax tar/zip package flow | Supported | `scripts/package.sh`, `scripts/validate-package.sh`, local package smoke validation | Add platform schema validation when Nuwax schemas are available. |
| P1 | Distribution + Observability | Install, upgrade, rollback, and uninstall scripts | Supported locally | `scripts/install.sh`, `scripts/upgrade.sh`, `scripts/uninstall.sh`, `/tmp` lifecycle smoke validation | Validate with production platform installer. |
| P1 | Distribution + Observability | Code graph and inspector | Supported | `npm run graph`, inspector package | Include graph entry in platform JSON. |
| P0 | Scenario Agent Generation | User prompt to Agent Spec workflow | Supported | `skills/builtin/agent-requirement-to-spec/SKILL.md`, `prompts/developer-agent.system.md`, `docs/scenario-agent-examples.md` | Add automated smoke examples later. |
| P0 | Scenario Agent Generation | `.nuwax-agent` capability source separation | Supported | `.nuwax-agent/capability-sources.json`, `.nuwax-agent/panel.config.json`, `.nuwax-agent/debug.agent_servers.example.json` | Wire panel schema validation when platform schemas are available. |
| P0 | Product-Grade Gaps | Reduce private `deepagents-acp` patch risk | Planned | Current ACP server patches private internals | Isolate patches or move to upstream-supported hooks. |
| P1 | Product-Grade Gaps | Harness lifecycle: phase, turn snapshot, busy state, pending writes | Planned | pi-mono comparison | Design before runtime change. |
| P1 | Product-Grade Gaps | Durable session list/load/close semantics | Planned | Codex ACP comparison | Add DB or stable session index later. |
| P2 | Product-Grade Gaps | ACP auth/logout capability | Planned | Codex ACP comparison | Add only if target clients require it. |
| P2 | Product-Grade Gaps | Stronger sandbox/environment profiles | Planned | Codex permission profile comparison | Define profile model before implementation. |
| P0 | Platform Validation | Nuwax production endpoint validation | Blocked | Needs platform credentials | Validate component list, prompt save, and debug sessions. |

## Priority Slices

### P0

- Keep OpenAI-compatible debug profile as the default.
- Rotate any exposed local API keys before publishing artifacts.

### P1

- Reduce `deepagents-acp` private patch risk.
- Add durable install/upgrade/uninstall lifecycle scripts.
- Strengthen session persistence semantics.
- Add harness lifecycle design before runtime changes.

### P2

- Add ACP auth/logout if target clients require it.
- Add stronger sandbox/environment profiles.
- Add long-running context endurance tests.

## Verification Commands

Run these before declaring the template ready after roadmap changes:

```bash
npm run typecheck
npm test
npm run build
npm run graph
```

Package lifecycle work should additionally run:

```bash
bash scripts/package.sh --format all
bash scripts/install.sh --artifact dist-packages/deepagents-dev-templates-0.1.1.zip --install-root /tmp/nuwax-agent-test
bash scripts/upgrade.sh --rollback --install-root /tmp/nuwax-agent-test
bash scripts/uninstall.sh --install-root /tmp/nuwax-agent-test --keep-data
```
