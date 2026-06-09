# Inspector: Read-only → Editable Orchestration

**Status:** Design approved (brainstorm), pending implementation plan
**Date:** 2026-06-09
**Scope:** `packages/inspector` (consumes `packages/template` public API)

## Context

The inspector today produces a read-only `AgentOrchestrationSpec` — a projection
of the agent's `AppConfig` plus (in `--full`) the compiled LangGraph topology. The
project's north-star is a **self-hosted, in-tree analog of LangSmith / LangGraph
Studio's "visualize + edit the current agent orchestration"** capability (no
LangSmith SaaS; config-as-source-of-truth). This design makes the inspector
**editable**: edit the orchestration and write it back to the structured config +
editable-zone text files.

## Goals / Non-goals

**In scope (v1):**
- Edit **structured config** fields surfaced in the spec (model, permissions,
  agent meta, middleware on/off + params, compaction/eviction, memory, skills dirs).
- Edit **existing prompt / skill / subagent text** (system prompt file, `SKILL.md`,
  `AGENT.md`).
- Studio-style UI: config-derived orchestration graph (center) + right editor panel.
- Preview-diff → confirm → write, with Zod + protected-zone guards.

**Out of scope (v1, deferred):**
- Adding/removing entities (new subagents, skills, MCP servers, hooks).
- Editing tools (code-defined — would mean writing TypeScript).
- A raw-JSON / Monaco "advanced" editor (possible secondary affordance, later).
- Running threads / state inspection / time-travel (Studio runtime debugging).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Editable scope | config fields + existing prompt/skill text | the editable orchestration surface |
| Edit depth | edit existing values only (no add/remove) | YAGNI; simple data model |
| Save model | preview diff → confirm → write | writes real project files; preview is safer |
| Layout | Studio-style: graph center + right editor panel | matches LangGraph Studio mental model |
| Center canvas | config-derived orchestration graph (dry-run + full) | editing needs no creds; `--full` overlays real LangGraph |
| Write target | the **source** `app-agent.config.json` (raw, unmerged) + text files | clean write-back; show merged value + provenance badge |
| Reverse-projection from spec | rejected | spec is a lossy projection; round-trip is fragile |

## Architecture

All new code lives in `packages/inspector`. Template is touched in exactly one
place (expose its already-exported `AppConfigSchema` through the runtime adapter).

### Core abstraction — `editable-model`

A declarative table: each editable field → `{ configPath (dot path), type
(enum|number|string|boolean|string[]), target (file), widget }`. Single source of
truth that drives **both** the right-panel UI widgets **and** server-side
validation/write. Enum values and numeric ranges are aligned with the template's
`AppConfigSchema`.

### Inspector modules (new)

| Module | Responsibility |
|---|---|
| `editing/editable-model.ts` | The editable-field declarations (above). |
| `editing/config-source.ts` | Read/write the **source** `app-agent.config.json` (raw, unmerged); Zod-validate via template's `AppConfigSchema`. |
| `editing/provenance.ts` | Compare source value vs merged effective value (from `loadConfig`) → flag env / `.deepagents`-shadowed fields. |
| `editing/text-files.ts` | Read/write prompt / `SKILL.md` / `AGENT.md` text (protected-zone guarded). |
| `editing/diff.ts` | Compute per-file before/after diffs for the preview. |
| `editing/writer.ts` | Apply: validate → protected-zone guard → optimistic-concurrency check → atomic write. |

### Server endpoints (`src/server.ts`)

- `GET  /api/spec` — unchanged (read-only snapshot, now includes an `editable` block).
- `POST /api/preview` — body: edits → `{ files: [{path, kind, before, after}], validation }`.
- `POST /api/apply` — body: edits → validate + write → returns a freshly re-inspected spec.

The **edits payload** is `{ config: Record<dotPath, value>, text: [{ path, content }] }`:
`config` is a flat map of changed `app-agent.config.json` fields keyed by dot-path
(merged into the raw source before validation); `text` is full replacement content
for edited prompt/skill/subagent files. Each edited file also carries the
read-time `baseHash` for the optimistic-concurrency check.

The server receives `workspaceRoot` / `configPath` from the CLI at startup.

### Types (`src/types.ts`)

Add an `editable` block to `AgentOrchestrationSpec` (per-section: which fields are
editable + per-field provenance), and the preview/apply request/response types.

### Template touch (minimal)

Extend the inspector's `template-runtime.ts` `TemplateRuntime` interface to expose
the template's already-exported `AppConfigSchema` (used for validation). The
inspector depends on the template's **public barrel** (`src/runtime/index.ts`), so
it is unaffected by template-internal file moves. All file I/O is done by the
inspector (it operates on a workspace).

## UI (`web/graph-ui/`)

- **Center**: config-derived orchestration graph. Nodes per spec section (Agent,
  Model, Prompt, Tools, Subagents, Skills, Middleware, Permissions, Memory).
  Editable nodes are highlighted; read-only nodes (Tools = code-defined,
  Subagents/Skills.files = file-discovered, Graph) are shown greyed with a "🔒
  defined in code / discovered" note. In `--full`, the real compiled LangGraph
  topology is overlaid / toggleable.
- **Right editor panel**: driven by `editable-model`. Widget per type — enum→dropdown,
  number→number input, boolean→toggle, string→text, string[]→tag-list editor,
  prompt/skill→multi-line textarea. Per-field "overridden by env" badge (with the
  effective value) when source ≠ merged. Inline Zod errors; Apply disabled while invalid.
- **Change bar + diff modal**: change counter → "Review diff" → per-file before/after
  diff → "Apply" / "Discard" (per-file opt-in).

## Data flow

```
workspace files                inspector (server)                browser UI
app-agent.config.json (SOURCE) ─ loadConfig() → merged effective
prompts/*.md, SKILL.md, AGENT.md  readConfigSource() → raw source
                                  provenance: source vs effective → badges
                                  inspectAgent + editable-model → spec{editable}
   GET /api/spec ───────────────────────────────────────────────► render graph + forms
                                                                    user edits (in-memory)
   POST /api/preview ◄──────────────────────────────────────────── edits
   diff.ts: per-file before/after ──────────────────────────────► diff modal
                                                                    user clicks Apply
   POST /api/apply ◄──────────────────────────────────────────────┘
   validate (AppConfigSchema) → protected-zone guard → concurrency check → atomic write
   re-run inspectAgent → fresh spec ────────────────────────────► re-render
```

## Validation & safety (the apply gates, in order)

1. **Config validation** — run `AppConfigSchema.parse()` on the edited source JSON
   before writing. On failure, return field-level errors; UI highlights the field;
   no write.
2. **Protected-zone guard** — every target path must resolve inside an editable zone
   (`config/`, `prompts/`, `skills/`, `.agents/`) and within `workspaceRoot`. Reject
   `src/runtime` / `src/surfaces` and any `../` / absolute escape. Reuses the
   template's sandbox/deniedPaths concept (same protection the agent itself honors).
3. **Optimistic concurrency** — capture each target file's content hash at read time;
   on apply, if the on-disk content differs from that baseline (edited elsewhere),
   reject and prompt reload. Never clobber external edits.
4. **Atomic write** — temp file + `rename`.
5. **Minimal diff** — re-serialize `app-agent.config.json` with 2-space indent
   (matches the repo); it is plain `.json` (no comments) so nothing is lost.
6. **Secrets** — config stores no secrets (env/placeholders). `baseUrl` / `apiKeyEnv`
   names are editable; secret values are never displayed or written.
7. **dry-run / full parity** — editing config needs no LLM; behavior is identical in
   both modes. `--full` only adds the real graph layer.

## Testing

Automated tests concentrate on the editing logic + server endpoints; the CDN
React-Flow UI is verified manually (light DOM smoke at most). Follows the existing
`INSPECTOR_TEMPLATE_SOURCE=1` vitest setup.

- **Unit**: editable-model field→path mapping; `config-source` read/write round-trip;
  `provenance` (source vs merged); `diff` computation; protected-zone guard (allow
  editable zones / reject runtime + `../` escape); Zod rejection of invalid values.
- **Server**: `/api/preview` returns expected per-file diff; `/api/apply` writes +
  returns fresh spec; `/api/apply` rejects invalid config, protected path, and stale
  baseline.
- **Regression**: existing 6 inspector tests stay green; `GET /api/spec` and the
  dry-run/full read-only paths are unchanged.

## Future (post-v1)

- Add/remove entities (subagents, skills, MCP servers, hooks).
- Raw-JSON / Monaco "Advanced" editor tab as a secondary affordance.
- Studio-style runtime debugging (threads, state, time-travel) — separate effort.
