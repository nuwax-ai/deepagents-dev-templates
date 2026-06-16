# Agent Core Progress

This document is the canonical progress tracker for the agent core in
`packages/deepagents-app-ts`. It records what is supported today, what is planned, and
what remains blocked by platform or protocol dependencies.

Architecture & runtime-flow diagrams: [runtime-architecture.md](../../../packages/deepagents-app-ts/docs/architecture/runtime-architecture.md).

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
| DeepAgents template runtime | 88% | Runtime, tools, skills, ACP entry, config, and tests are in place; aligned to deepagents built-ins (no duplicated middleware). |
| Product-grade agent core | 86% | ACP now rides upstream public lifecycle hooks (no private patching), durable local session load/close, harness lifecycle snapshots, and local sandbox profiles exist; auth/logout remains planned. |
| Nuwax/Zed integration | Supported | Real Zed ACP launch, streaming, tool calls, and permissions have been validated. |
| Distribution lifecycle | Supported locally | npm tgz, Nuwax tar/zip with bundled production `node_modules`, version/platform JSON, checksums, local install, upgrade, rollback, and uninstall scripts exist; platform production installer validation remains planned. |

## Progress Table

| Priority | Area | Capability | Status | Evidence | Next Step |
|---|---|---|---|---|---|
| P0 | Runtime Core | DeepAgents runtime creation | Supported | `src/runtime/agent-factory.ts`, build/test pass | Keep aligned with deepagents upgrades. |
| P0 | Runtime Core | Model config for Anthropic and OpenAI-compatible providers | Supported | `config-loader.ts`, `helpers.ts`, provider tests | Prefer OpenAI-compatible in `.nuwax-agent` debug profiles. |
| P0 | Runtime Core | App middleware (harness-lifecycle, reminders, cost, stuck-loop, fs-path-resolver) layered over deepagents built-ins | Supported | `middleware/*` + `harness-lifecycle.test.ts`, `permissions.test.ts` | Compaction/eviction/protected-paths now come from deepagents built-ins (summarization + FilesystemMiddleware), not custom middleware. |
| P0 | Runtime Core | Built-in skills and platform skills | Supported | `skills/builtin/`, `skills/platform/` | Keep scenario generation skill aligned with prompt template. |
| P0 | ACP Client Core | ACP stdio startup | Supported | ACP smoke test and real Zed integration | Keep smoke test LLM-free. |
| P0 | ACP Client Core | Zed initialize/session/new/prompt streaming | Supported | Real Zed integration | Keep Zed docs current. |
| P0 | ACP Client Core | Tool call streaming and permission prompts | Supported | Real Zed integration, protected path tests | Track upstream `deepagents-acp` changes. |
| P0 | ACP Client Core | Cancel handling and stale session recovery | Supported | ACP integration verification | Now on upstream public `DeepAgentsServerHooks` — private patches removed. |
| P0 | Workspace + Safety | Editable zone separation | Supported | `template.manifest.json`, prompt rules, permission middleware | Keep `src/runtime/` protected by default. |
| P0 | Workspace + Safety | Protected path denial for runtime files | Supported | deepagents built-in FilesystemMiddleware via forwarded `permissions`; `permissions.test.ts` | Custom `protected-paths` middleware removed (upstream B1 forwards `permissions` in ACP mode). |
| P1 | Context + Memory | Runtime storage, messages, plan, todos, checkpoints | Supported | `runtime-storage.ts`, unit tests | Add migration docs for platform install layout. |
| P1 | Context + Memory | Durable session metadata, list, read, load, and close markers | Supported locally | `loadSessionState`, `readSessionMetadata`, `readRuntimeMessages`, `closeSessionState`, `/session <id>`, ACP load/list/close merge | Add DB or stable platform session index when ACP/client contract is stable. |
| P1 | Context + Memory | Harness lifecycle: phase, turn snapshot, busy state, pending writes | Supported locally | `harness-lifecycle.ts`, `middleware/harness-lifecycle.ts` (sole turn owner), ACP `onPrompt*` hooks (slash + idempotent backstop), `runtime_info.includeLifecycle` | Add client-visible lifecycle events if ACP client contract exposes them. |
| P1 | Workspace + Safety | Sandbox/environment profiles | Supported locally | `sandbox.profile`, `DEEPAGENTS_SANDBOX_PROFILE`, `.nuwax-agent/sandbox-profiles.json`, permission tests | Add platform panel schema validation when Nuwax schemas are available. |
| P1 | Context + Memory | Conversation history, memory, checkpoint tools | Supported | Tool registry and unit tests | Add scenario examples using these tools. |
| P1 | Context + Memory | Compaction and large output eviction | Supported (deepagents built-in) | `createSummarizationMiddleware` + `createFilesystemMiddleware` via `createDeepAgent` | Custom compaction/eviction middleware removed; add end-to-end long-session scenario later. |
| P0 | Tooling + Integration | Built-in custom tools | Supported | `src/app/tools/` and tests | Keep tool descriptions scenario-agent friendly. |
| P0 | Tooling + Integration | MCP config merge and platform MCP hydration | Supported | `mcp-manager` tests and startup path, `.nuwax-agent/capability-sources.json` | Keep ACP dynamic vs builtin boundaries in sync with panel config. |
| P1 | Tooling + Integration | Platform API prompt save, component list, debug sessions | Supported locally | Unit tests with mocked platform client | Validate production endpoints with platform credentials. |
| P1 | Distribution + Observability | npm/tgz and Nuwax tar/zip package flow with bundled dependencies | Supported | `scripts/package.sh`, `scripts/validate-package.sh --require-node-modules`, local package smoke validation | Add platform schema validation when Nuwax schemas are available. |
| P1 | Distribution + Observability | Install, upgrade, rollback, and uninstall scripts | Supported locally | `scripts/install.sh`, `scripts/upgrade.sh`, `scripts/uninstall.sh`, `/tmp` lifecycle smoke validation | Validate with production platform installer. |
| P1 | Distribution + Observability | Code graph and inspector | Supported | `npm run graph`, inspector package | Include graph entry in platform JSON. |
| P0 | Scenario Agent Generation | User prompt to Agent Spec workflow | Supported | `skills/builtin/agent-requirement-to-spec/SKILL.md`, `prompts/developer-agent.system.md`, `docs/scenario-agent-examples.md`, `scenario-agent-spec.test.ts` | Add platform-driven generation tests later. |
| P0 | Scenario Agent Generation | `.nuwax-agent` capability source separation | Supported | `.nuwax-agent/capability-sources.json`, `.nuwax-agent/panel.config.json`, `.nuwax-agent/debug.agent_servers.example.json`, `.nuwax-agent/rcoder.chat.agent_servers.example.json` | Wire panel schema validation when platform schemas are available. |
| P0 | Product-Grade Gaps | Remove private `deepagents-acp` patching | Supported | Migrated to upstream public `DeepAgentsServerHooks` (configureSession / onPrompt* / onSessionClosed); `acp-server-internals.ts` removed | Land hooks (B1+B2) in a published `deepagents-acp` release. |
| P1 | Product-Grade Gaps | Durable session load semantics | Supported locally | `loadSessionState`, `/session <id>`, ACP `handleLoadSession` metadata marker | Add platform-backed DB/index if multi-device or remote resume becomes required. |
| P2 | Product-Grade Gaps | ACP auth/logout capability | Planned | Codex ACP comparison | Add only if target clients require it. |
| P2 | Product-Grade Gaps | Platform-enforced sandbox profile validation | Planned | Codex permission profile comparison | Validate panel/runtime profile handoff with Nuwax schemas. |
| P0 | Platform Validation | Nuwax production endpoint validation | Blocked | Needs platform credentials | Validate component list, prompt save, and debug sessions. |
| P0 | Distribution + Observability | Depends on unreleased deepagents / deepagents-acp (B1 permissions forward, B2 lifecycle hooks, handleLoadSession rebuild) | Blocked | Linked via root `pnpm.overrides` → `file:../deepagentsjs`, branch `feat/acp-permissions-and-lifecycle` | Publish/merge upstream then pin a released version. Nuwax bundle vendors the fork (OK); the npm-package path breaks on `deepagents@1.10.2` until then. |
| P1 | Tooling + Integration | Platform-delivered MCP config + HTTP/SSE MCP over ACP | Planned | `mcp-manager.setPlatformConfig` (`@scaffold`, unwired); `mcp-acp-adapter` skips HTTP/SSE | Wire `setPlatformConfig` from `createRuntimeContext`; test HTTP/SSE forwarding. |

## Priority Slices

### P0

- Keep OpenAI-compatible debug profile as the default.
- Rotate any exposed local API keys before publishing artifacts.

### P1

- Add platform-backed durable session index/load semantics when remote resume is required.
- Add client-visible lifecycle events when the ACP client contract supports them.

### P2

- Add ACP auth/logout if target clients require it.
- Add platform-enforced sandbox profile validation.
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
