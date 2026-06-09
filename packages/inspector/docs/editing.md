# Editing orchestration in the Inspector UI

The browser UI at `http://localhost:<port>` is a Studio-style editor for the
`AgentOrchestrationSpec`. Edits are validated and written back to the original
`app-agent.config.json` plus any text files (system prompt, `SKILL.md`,
`AGENT.md`) that the spec references.

The inspector never mutates the template's source. It only writes to the
editable zones configured for the agent.

## What's editable (v1)

30 fields across 7 sections, declared in
[`src/editing/editable-model.ts`](../src/editing/editable-model.ts). The spec
emits the full list under `editable.fields` so the UI can render without
hardcoding.

| Section | Fields |
|---|---|
| Agent meta | `agent.name`, `agent.description`, `agent.version`, `agent.outputStyle`, `agent.systemPromptPath`, `agent.includeWorkspaceInstructions` |
| Model | `model.provider`, `model.name`, `model.baseUrl`, `model.apiKeyEnv`, `model.authTokenEnv`, `model.settings.temperature`, `model.settings.maxTokens` |
| Permissions | `permissions.mode`, `permissions.interruptOn`, `permissions.allowedPaths`, `permissions.deniedPaths` |
| Middleware | `middleware.stuckLoopDetection.{enabled,threshold,mode}`, `middleware.periodicReminder.{enabled,firstAt,every}`, `middleware.costTracking.{enabled,warnAtTokens}` |
| Lifecycle | `compaction.enabled`, `eviction.enabled` |
| Memory | `memory.enabled`, `memory.addCacheControl` |
| Skills | `skills.directories` |

Each field carries a `widget` hint (`dropdown | number | text | switch | taglist
| textarea`) so the UI does not have to second-guess the type.

### Out of scope for v1

- Adding or removing entries (subagents, skills, MCP servers, hooks).
- Editing tools (those are code-defined, not config-defined).
- A raw JSON / Monaco "advanced" tab.
- Runtime debugging (thread inspection, time travel) — that's a separate
  Studio-style feature and a separate project.

## Endpoints

All editing endpoints are mounted on the existing `startInspectServer`. They
are only registered when the server boots with an `editing` option.

### `GET /api/spec`

The spec now includes an `editable` block:

```json
{
  "editable": {
    "configFile": "config/app-agent.config.json",
    "configBaseHash": "37ce913f3ec9...",
    "fields": [
      {
        "id": "model.name",
        "configPath": "model.name",
        "section": "model",
        "type": "string",
        "widget": "text",
        "label": "Model name",
        "sourceValue": "claude-sonnet-4-6",
        "effectiveValue": "claude-sonnet-4-6",
        "overridden": false
      }
    ]
  }
}
```

`overridden: true` means the merged config value differs from the raw source
file (an env var or `.deepagents` override is in effect). The UI shows an
"env override" badge and the effective value.

### `POST /api/preview`

Compute a per-file before/after diff for a pending edit. The body is the
edit payload (see below). Returns 200 with `{ files, validation }` when valid,
422 when Zod rejects the candidate config.

### `POST /api/apply`

Write the edits. Returns 200 with the new spec on success. Returns 422 on
validation failure, 409 on optimistic-concurrency mismatch (see below).

### `GET /api/text?path=<relPath>`

Read a text file's full content + content hash. The path must be relative,
inside the workspace, and not under any `permissions.deniedPaths` entry.
Returns 200 with `{ path, content, hash }`, 400 on bad path, 404 when the
file does not exist.

Used by the UI to fetch long system prompts that the spec truncates.

## Edit payload

```json
{
  "config": {
    "model.name": "gpt-4o",
    "middleware.stuckLoopDetection.threshold": 7
  },
  "configBaseHash": "37ce913f3ec9...",
  "text": [
    {
      "path": "prompts/code-assistant.system.md",
      "content": "...full new content...",
      "baseHash": "sha256-of-on-disk-content"
    }
  ]
}
```

- `config` is a flat `Record<dotPath, value>` map. Patched into the raw source
  via `setByPath`, never replaces whole subtrees.
- `configBaseHash` is **optional** but recommended. When supplied, the server
  hashes the on-disk config and rejects (409) the apply if the hash has
  changed since the spec was read. This is how the UI prevents the
  "I edited here, someone else edited there, my apply clobbers them" problem.
  If omitted, the legacy no-OCC behavior applies.
- `text[]` is the list of text-file edits. Each entry carries the
  `baseHash` of the file at the time the UI fetched it. The server rechecks
  and rejects (422) the apply if the file has changed on disk.

Both `config` and `text` may be omitted; the server defaults them to `{}` and
`[]` respectively. (The spec on the wire still has them as arrays/objects.)

## Protection model (write gates, in order)

1. **Zod validation** — the patched source is run through
   `AppConfigSchema.parse()`. Failures return field-level errors and the UI
   highlights the offending field. Nothing is written.
2. **Config optimistic concurrency** — if `configBaseHash` was supplied and
   the on-disk hash no longer matches, return 409 with the message
   "Config file changed on disk; reload before applying." Nothing is written.
3. **Protected-zone guard** — every target path (the config path and every
   text edit's `path`) is checked against the merged
   `config.permissions.deniedPaths`. Hard reject on:
   - absolute paths,
   - paths that escape `workspaceRoot` (`..` segments, cross-drive on
     Windows),
   - paths that resolve under any entry in `deniedPaths` (prefix match with
     separator normalization).
   The default denylist is `["src/runtime/", "src/surfaces/"]`, mirroring
   the agent's own sandbox. Edit `permissions.deniedPaths` in your config to
   extend it; the inspector picks up the new entries on the next server
   reload.
4. **Text-file optimistic concurrency** — every text edit's `baseHash` is
   compared against the on-disk hash. Stale entries return 422 with
   "File changed on disk; reload before applying." Nothing is written.
5. **Atomic writes** — the config and any text files are written to
   `<target>.tmp-<pid>-<ts>` and renamed into place. The temp file is
   unlinked on success by the rename.
6. **JSON serialization** — `app-agent.config.json` is re-serialized with
   2-space indentation. `setByPath` preserves the source key order, so
   the only diff you see in git is the fields you actually changed.
7. **`--full` mode is decoupled** — the apply endpoint always re-inspects
   in `dry-run` mode, even if the server booted with `--full`. This avoids
   triggering LLM / MCP sessions on the write path.
8. **No secrets in the wire format** — the UI never displays or sends a
   literal API key. `model.apiKeyEnv` / `model.authTokenEnv` carry the env
   variable *name* (e.g. `ANTHROPIC_API_KEY`), not the value.

`permissions.allowedPaths` is treated as a **soft UI hint** only. The panel
shows a "in allowedPaths" badge when a target matches an entry. It does
**not** gate writes.

## UI flow

1. Browser opens `http://localhost:7322`.
2. `GET /api/spec` populates the spec and the right-hand editing panel.
3. User edits fields. Changes are tracked in a client-side draft
   (`config: {...}, text: [...]`). Each field widget either feeds back into
   the draft or, for env/path strings, leaves the typed value untouched
   (no actual secrets are ever typed here).
4. Top-of-page change bar shows `N pending changes`.
5. User clicks "View diff" — the panel calls `POST /api/preview` with the
   current draft. The response is rendered as a per-file before/after
   modal. Validation errors are shown inline; the Apply button is disabled
   if validation failed.
6. User clicks "Apply" — the panel calls `POST /api/apply` with the same
   draft. On success, the new spec replaces the local copy and the draft
   is cleared. On 409, the panel prompts the user to reload.
7. The text file editor (system prompt + any discovered `SKILL.md` /
   `AGENT.md`) works the same way. The editor fetches the full content
   via `GET /api/text?path=...` so truncation in the spec is a non-issue.

## Disabling the editing UI

The CLI wires editing by default. To boot the inspector in pure
read-only mode (e.g. when the workspace has no editing API key), pass
`--out /tmp/spec.json` and skip the browser UI entirely — `writeOrchestrationSpec`
writes the spec to disk and exits without ever opening a server.

The editing server itself does not need an API key; it only needs read
access to the workspace.
