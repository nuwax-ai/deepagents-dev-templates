# Inspector Editable — Backend Engine + API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server-side editing engine + HTTP API that lets the inspector edit an agent's orchestration config and editable-zone text files, with preview-diff and validated/guarded writes.

**Architecture:** New `packages/inspector/src/editing/*` modules driven by a declarative `editable-model`; two new endpoints (`POST /api/preview`, `POST /api/apply`) on the existing Node http server. Edits bind to the **source** `app-agent.config.json` + editable-zone text files. Apply runs four gates: Zod validation (template's `AppConfigSchema`) → protected-zone path guard → optimistic-concurrency (content hash) → atomic write. This plan is backend-only; the web UI is a separate follow-up plan.

**Tech Stack:** TypeScript (ESM, NodeNext), Node http, vitest (`INSPECTOR_TEMPLATE_SOURCE=1`), template's exported Zod `AppConfigSchema`.

**Spec:** `docs/superpowers/specs/2026-06-09-inspector-editable-design.md`

**Precondition:** `packages/template` builds and its `./runtime` barrel exports `AppConfigSchema`, `loadConfig`, `resolveConfiguredWorkspaceRoot` (verify with `npm test -w packages/inspector` green before starting). The inspector consumes the template **public barrel** only, so template-internal file moves do not affect this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/inspector/src/template-runtime.ts` (modify) | Expose template's `AppConfigSchema` through the `TemplateRuntime` adapter. |
| `packages/inspector/src/editing/paths.ts` (create) | Dot-path get/set + sha256 hash helpers (shared, dependency-free). |
| `packages/inspector/src/editing/editable-model.ts` (create) | Declarative list of editable config fields (the single source of truth). |
| `packages/inspector/src/editing/text-files.ts` (create) | Editable-zone path guard + atomic read/write of text files. |
| `packages/inspector/src/editing/config-source.ts` (create) | Read raw source config, apply dot-path patch, Zod-validate. |
| `packages/inspector/src/editing/provenance.ts` (create) | Source vs merged-effective comparison → overridden-field flags. |
| `packages/inspector/src/editing/diff.ts` (create) | Per-file before/after payload for preview. |
| `packages/inspector/src/editing/writer.ts` (create) | `applyEdits` — the four-gate apply pipeline. |
| `packages/inspector/src/editing/index.ts` (create) | Barrel for the editing modules. |
| `packages/inspector/src/server.ts` (modify) | Accept `workspaceRoot`/`configPath`; add `POST /api/preview` + `/api/apply`. |
| `packages/inspector/src/cli/inspect.ts` (modify) | Pass `workspaceRoot`/`configPath` into `startInspectServer`. |
| `packages/inspector/tests/unit/editing/*.test.ts` (create) | Unit + server tests. |

---

## Task 1: Expose `AppConfigSchema` through the template-runtime adapter

**Files:**
- Modify: `packages/inspector/src/template-runtime.ts`
- Test: `packages/inspector/tests/unit/editing/template-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/template-schema.test.ts
import { describe, expect, it } from "vitest";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";

describe("template-runtime AppConfigSchema", () => {
  it("exposes a Zod schema that fills defaults and validates", async () => {
    const runtime = await loadTemplateRuntime();
    const parsed = runtime.AppConfigSchema.parse({});
    expect(parsed.agent.name).toBeTypeOf("string");
    expect(parsed.permissions.mode).toBe("ask");
  });

  it("rejects an invalid permissions mode", async () => {
    const runtime = await loadTemplateRuntime();
    const result = runtime.AppConfigSchema.safeParse({ permissions: { mode: "bogus" } });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/template-schema.test.ts`
Expected: FAIL — `runtime.AppConfigSchema` is undefined.

- [ ] **Step 3: Add `AppConfigSchema` to the `TemplateRuntime` interface**

In `packages/inspector/src/template-runtime.ts`, add to the `TemplateRuntime` interface (alongside `loadConfig`):

```ts
  AppConfigSchema: {
    parse(data: unknown): AppConfig;
    safeParse(data: unknown):
      | { success: true; data: AppConfig }
      | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };
  };
```

No change to `loadTemplateRuntime` is needed — it already returns the whole template `./runtime` barrel (source or compiled), which re-exports `AppConfigSchema`. The cast picks up the new field.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/template-schema.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/template-runtime.ts packages/inspector/tests/unit/editing/template-schema.test.ts
git commit -m "feat(inspector): expose template AppConfigSchema via runtime adapter"
```

---

## Task 2: Path + hash helpers (`editing/paths.ts`)

**Files:**
- Create: `packages/inspector/src/editing/paths.ts`
- Test: `packages/inspector/tests/unit/editing/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/paths.test.ts
import { describe, expect, it } from "vitest";
import { getByPath, setByPath, hashContent } from "../../../src/editing/paths.js";

describe("paths", () => {
  it("gets a nested value by dot path", () => {
    expect(getByPath({ model: { name: "x" } }, "model.name")).toBe("x");
    expect(getByPath({ model: {} }, "model.name")).toBeUndefined();
  });

  it("sets a nested value immutably, creating intermediate objects", () => {
    const src = { model: { name: "x" } };
    const out = setByPath(src, "model.settings.temperature", 0.5);
    expect(out).toEqual({ model: { name: "x", settings: { temperature: 0.5 } } });
    expect(src).toEqual({ model: { name: "x" } }); // unchanged
  });

  it("hashes content stably", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/paths.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/inspector/src/editing/paths.ts
import { createHash } from "node:crypto";

type Obj = Record<string, unknown>;

export function getByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Obj)[key];
  }
  return current;
}

/** Immutable nested set. Returns a new object; intermediate objects are cloned. */
export function setByPath<T extends Obj>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root: Obj = { ...obj };
  let cursor = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    const existing = cursor[key];
    cursor[key] = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Obj) }
      : {};
    cursor = cursor[key] as Obj;
  }
  cursor[keys[keys.length - 1]!] = value;
  return root as T;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/paths.ts packages/inspector/tests/unit/editing/paths.test.ts
git commit -m "feat(inspector): dot-path get/set and content hash helpers"
```

---

## Task 3: Editable-model declaration (`editing/editable-model.ts`)

**Files:**
- Create: `packages/inspector/src/editing/editable-model.ts`
- Test: `packages/inspector/tests/unit/editing/editable-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/editable-model.test.ts
import { describe, expect, it } from "vitest";
import { EDITABLE_CONFIG_FIELDS, findField } from "../../../src/editing/editable-model.js";

describe("editable-model", () => {
  it("declares model and permissions fields with correct types", () => {
    expect(findField("model.name")?.type).toBe("string");
    expect(findField("model.provider")?.type).toBe("enum");
    expect(findField("model.provider")?.enumValues).toEqual(["anthropic", "openai"]);
    expect(findField("permissions.mode")?.enumValues).toEqual(["yolo", "ask", "plan"]);
    expect(findField("model.settings.temperature")?.type).toBe("number");
  });

  it("has unique field ids that equal their configPath", () => {
    const ids = EDITABLE_CONFIG_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of EDITABLE_CONFIG_FIELDS) {
      expect(field.id).toBe(field.configPath);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/inspector/src/editing/editable-model.ts
export type FieldType = "enum" | "number" | "string" | "boolean" | "string[]";

export interface EditableField {
  /** Equals configPath; stable id used by the UI and apply payload. */
  id: string;
  /** Graph node / panel section this field belongs to. */
  section: string;
  /** Dot path into the source AppConfig JSON. */
  configPath: string;
  type: FieldType;
  label: string;
  enumValues?: string[];
  min?: number;
  max?: number;
}

function f(field: Omit<EditableField, "id">): EditableField {
  return { id: field.configPath, ...field };
}

export const EDITABLE_CONFIG_FIELDS: EditableField[] = [
  f({ section: "meta", configPath: "agent.name", type: "string", label: "Name" }),
  f({ section: "meta", configPath: "agent.description", type: "string", label: "Description" }),
  f({ section: "meta", configPath: "agent.version", type: "string", label: "Version" }),
  f({ section: "meta", configPath: "agent.outputStyle", type: "string", label: "Output style" }),

  f({ section: "model", configPath: "model.provider", type: "enum", label: "Provider", enumValues: ["anthropic", "openai"] }),
  f({ section: "model", configPath: "model.name", type: "string", label: "Model name" }),
  f({ section: "model", configPath: "model.baseUrl", type: "string", label: "Base URL" }),
  f({ section: "model", configPath: "model.settings.temperature", type: "number", label: "Temperature", min: 0, max: 2 }),
  f({ section: "model", configPath: "model.settings.maxTokens", type: "number", label: "Max tokens", min: 1 }),

  f({ section: "permissions", configPath: "permissions.mode", type: "enum", label: "Mode", enumValues: ["yolo", "ask", "plan"] }),
  f({ section: "permissions", configPath: "permissions.interruptOn", type: "string[]", label: "Interrupt on" }),
  f({ section: "permissions", configPath: "permissions.allowedPaths", type: "string[]", label: "Allowed paths" }),
  f({ section: "permissions", configPath: "permissions.deniedPaths", type: "string[]", label: "Denied paths" }),

  f({ section: "middleware", configPath: "middleware.stuckLoopDetection.enabled", type: "boolean", label: "Stuck-loop detection" }),
  f({ section: "middleware", configPath: "middleware.periodicReminder.enabled", type: "boolean", label: "Periodic reminder" }),
  f({ section: "middleware", configPath: "middleware.costTracking.enabled", type: "boolean", label: "Cost tracking" }),
  f({ section: "middleware", configPath: "compaction.enabled", type: "boolean", label: "Compaction" }),
  f({ section: "middleware", configPath: "eviction.enabled", type: "boolean", label: "Eviction" }),

  f({ section: "memory", configPath: "memory.enabled", type: "boolean", label: "Memory" }),
  f({ section: "memory", configPath: "memory.addCacheControl", type: "boolean", label: "Cache control" }),

  f({ section: "skills", configPath: "skills.directories", type: "string[]", label: "Skill directories" }),
];

export function findField(configPath: string): EditableField | undefined {
  return EDITABLE_CONFIG_FIELDS.find((field) => field.configPath === configPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/editable-model.ts packages/inspector/tests/unit/editing/editable-model.test.ts
git commit -m "feat(inspector): declarative editable-model for config fields"
```

---

## Task 4: Editable-zone guard + atomic text I/O (`editing/text-files.ts`)

**Files:**
- Create: `packages/inspector/src/editing/text-files.ts`
- Test: `packages/inspector/tests/unit/editing/text-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/text-files.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEditablePath, readTextFile, writeTextFileAtomic } from "../../../src/editing/text-files.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-edit-"));
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("text-files", () => {
  it("allows paths inside editable zones", () => {
    expect(() => assertEditablePath(root, "prompts/sys.md")).not.toThrow();
    expect(() => assertEditablePath(root, "config/app-agent.config.json")).not.toThrow();
  });

  it("rejects protected and escaping paths", () => {
    expect(() => assertEditablePath(root, "src/runtime/x.ts")).toThrow();
    expect(() => assertEditablePath(root, "../outside.md")).toThrow();
    expect(() => assertEditablePath(root, "/etc/passwd")).toThrow();
  });

  it("reads with a content hash and round-trips an atomic write", () => {
    const read = readTextFile(root, "prompts/sys.md");
    expect(read?.content).toBe("hello");
    writeTextFileAtomic(root, "prompts/sys.md", "world");
    expect(readTextFile(root, "prompts/sys.md")?.content).toBe("world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/text-files.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/inspector/src/editing/text-files.ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { hashContent } from "./paths.js";

/** Workspace-relative directories the inspector is allowed to write into. */
export const EDITABLE_ZONES = ["config", "prompts", "skills", ".agents"];

/** Throws if relPath is absolute, escapes the workspace, or is outside an editable zone. */
export function assertEditablePath(workspaceRoot: string, relPath: string): void {
  if (isAbsolute(relPath)) {
    throw new Error(`Refusing absolute path: ${relPath}`);
  }
  const abs = resolve(workspaceRoot, relPath);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  const top = rel.split(/[/\\]/)[0]!;
  if (!EDITABLE_ZONES.includes(top)) {
    throw new Error(`Path is outside an editable zone (${EDITABLE_ZONES.join(", ")}): ${relPath}`);
  }
}

export interface ReadFile {
  content: string;
  hash: string;
}

export function readTextFile(workspaceRoot: string, relPath: string): ReadFile | null {
  assertEditablePath(workspaceRoot, relPath);
  const abs = resolve(workspaceRoot, relPath);
  if (!existsSync(abs)) {
    return null;
  }
  const content = readFileSync(abs, "utf-8");
  return { content, hash: hashContent(content) };
}

export function writeTextFileAtomic(workspaceRoot: string, relPath: string, content: string): void {
  assertEditablePath(workspaceRoot, relPath);
  const abs = resolve(workspaceRoot, relPath);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, abs);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/text-files.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/text-files.ts packages/inspector/tests/unit/editing/text-files.test.ts
git commit -m "feat(inspector): editable-zone path guard and atomic text I/O"
```

---

## Task 5: Source config read + patch + validate (`editing/config-source.ts`)

**Files:**
- Create: `packages/inspector/src/editing/config-source.ts`
- Test: `packages/inspector/tests/unit/editing/config-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/config-source.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { readConfigSource, patchConfigSource, validateConfig } from "../../../src/editing/config-source.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-cfg-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, "config/app-agent.config.json"),
    JSON.stringify({ model: { name: "claude-x" } }, null, 2), "utf-8");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("config-source", () => {
  it("reads the raw source with a hash", () => {
    const src = readConfigSource(root, "config/app-agent.config.json");
    expect((src.raw.model as { name: string }).name).toBe("claude-x");
    expect(src.hash).toBeTypeOf("string");
  });

  it("applies a flat dot-path patch immutably", () => {
    const src = readConfigSource(root, "config/app-agent.config.json");
    const patched = patchConfigSource(src.raw, { "model.name": "gpt-4o", "permissions.mode": "yolo" });
    expect((patched.model as { name: string }).name).toBe("gpt-4o");
    expect((patched.permissions as { mode: string }).mode).toBe("yolo");
  });

  it("validates a patched source against AppConfigSchema", async () => {
    const runtime = await loadTemplateRuntime();
    const ok = validateConfig(runtime, { model: { name: "gpt-4o" } });
    expect(ok.ok).toBe(true);
    const bad = validateConfig(runtime, { permissions: { mode: "nope" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.path).toContain("permissions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/config-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/inspector/src/editing/config-source.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TemplateRuntime } from "../template-runtime.js";
import { hashContent, setByPath } from "./paths.js";

type Obj = Record<string, unknown>;

export interface ConfigSource {
  raw: Obj;
  hash: string;
}

export function readConfigSource(workspaceRoot: string, configPath: string): ConfigSource {
  const abs = resolve(workspaceRoot, configPath);
  if (!existsSync(abs)) {
    return { raw: {}, hash: hashContent("") };
  }
  const text = readFileSync(abs, "utf-8");
  return { raw: JSON.parse(text) as Obj, hash: hashContent(text) };
}

/** Apply a flat { dotPath: value } map onto a raw source object, immutably. */
export function patchConfigSource(raw: Obj, patch: Record<string, unknown>): Obj {
  let next = raw;
  for (const [path, value] of Object.entries(patch)) {
    next = setByPath(next, path, value);
  }
  return next;
}

export interface FieldError {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: FieldError[] };

export function validateConfig(runtime: TemplateRuntime, candidate: Obj): ValidationResult {
  const result = runtime.AppConfigSchema.safeParse(candidate);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

/** Serialize a raw source object back to JSON text (2-space indent, matches repo). */
export function serializeConfigSource(raw: Obj): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/config-source.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/config-source.ts packages/inspector/tests/unit/editing/config-source.test.ts
git commit -m "feat(inspector): source config read, dot-path patch, Zod validate"
```

---

## Task 6: Provenance (source vs merged) (`editing/provenance.ts`)

**Files:**
- Create: `packages/inspector/src/editing/provenance.ts`
- Test: `packages/inspector/tests/unit/editing/provenance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/provenance.test.ts
import { describe, expect, it } from "vitest";
import { computeProvenance } from "../../../src/editing/provenance.js";
import { EDITABLE_CONFIG_FIELDS } from "../../../src/editing/editable-model.js";

describe("provenance", () => {
  it("flags a field whose merged value differs from the source", () => {
    const rawSource = { model: { name: "claude-x" }, permissions: { mode: "ask" } };
    const merged = { model: { name: "claude-x" }, permissions: { mode: "plan" } }; // env override
    const prov = computeProvenance(rawSource, merged, EDITABLE_CONFIG_FIELDS);
    const mode = prov.find((p) => p.configPath === "permissions.mode")!;
    expect(mode.overridden).toBe(true);
    expect(mode.effectiveValue).toBe("plan");
    const name = prov.find((p) => p.configPath === "model.name")!;
    expect(name.overridden).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/provenance.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/inspector/src/editing/provenance.ts
import type { EditableField } from "./editable-model.js";
import { getByPath } from "./paths.js";

export interface FieldProvenance {
  configPath: string;
  sourceValue: unknown;
  effectiveValue: unknown;
  /** true when the effective (merged) value differs from the source file value. */
  overridden: boolean;
}

export function computeProvenance(
  rawSource: Record<string, unknown>,
  mergedConfig: Record<string, unknown>,
  fields: EditableField[]
): FieldProvenance[] {
  return fields.map((field) => {
    const sourceValue = getByPath(rawSource, field.configPath);
    const effectiveValue = getByPath(mergedConfig, field.configPath);
    const overridden =
      sourceValue !== undefined &&
      JSON.stringify(sourceValue) !== JSON.stringify(effectiveValue);
    return { configPath: field.configPath, sourceValue, effectiveValue, overridden };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/provenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/provenance.ts packages/inspector/tests/unit/editing/provenance.test.ts
git commit -m "feat(inspector): config field provenance (source vs merged)"
```

---

## Task 7: Apply pipeline with four gates (`editing/writer.ts` + `diff.ts` + `index.ts`)

**Files:**
- Create: `packages/inspector/src/editing/diff.ts`
- Create: `packages/inspector/src/editing/writer.ts`
- Create: `packages/inspector/src/editing/index.ts`
- Test: `packages/inspector/tests/unit/editing/writer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/writer.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { previewEdits, applyEdits } from "../../../src/editing/writer.js";
import { hashContent } from "../../../src/editing/paths.js";

let root: string;
const CFG = "config/app-agent.config.json";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-writer-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-x" } }, null, 2), "utf-8");
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("writer", () => {
  it("preview returns per-file before/after without writing", async () => {
    const runtime = await loadTemplateRuntime();
    const preview = previewEdits(runtime, root, CFG, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(preview.validation.ok).toBe(true);
    const cfgDiff = preview.files.find((f) => f.path === CFG)!;
    expect(cfgDiff.after).toContain("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello"); // not written
  });

  it("apply writes files and re-validates", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("world");
  });

  it("rejects invalid config (gate 1) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, { config: { "permissions.mode": "nope" }, text: [] });
    expect(result.ok).toBe(false);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("claude-x");
  });

  it("rejects a protected target path (gate 2)", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: {},
      text: [{ path: "src/runtime/x.ts", content: "x", baseHash: hashContent("") }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a stale baseHash (gate 3) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, {
      config: {},
      text: [{ path: "prompts/sys.md", content: "world", baseHash: "stale" }],
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/writer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3a: Write `diff.ts`**

```ts
// packages/inspector/src/editing/diff.ts
export interface FileDiff {
  path: string;
  kind: "config" | "text";
  before: string;
  after: string;
}
```

- [ ] **Step 3b: Write `writer.ts`**

```ts
// packages/inspector/src/editing/writer.ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TemplateRuntime } from "../template-runtime.js";
import {
  patchConfigSource,
  readConfigSource,
  serializeConfigSource,
  validateConfig,
  type FieldError,
} from "./config-source.js";
import type { FileDiff } from "./diff.js";
import { hashContent } from "./paths.js";
import { assertEditablePath, writeTextFileAtomic } from "./text-files.js";

export interface TextEdit {
  path: string;
  content: string;
  /** sha256 of the file content read by the client; guards against external edits. */
  baseHash: string;
}

export interface EditPayload {
  /** Flat { dotPath: value } changes to the source app-agent.config.json. */
  config: Record<string, unknown>;
  /** Full-replacement content for edited text files. */
  text: TextEdit[];
}

export interface PreviewResult {
  files: FileDiff[];
  validation: { ok: true } | { ok: false; errors: FieldError[] };
}

export type ApplyResult =
  | { ok: true; written: string[] }
  | { ok: false; errors: Array<{ path?: string; message: string }> };

function buildConfigDiff(workspaceRoot: string, configPath: string, patch: Record<string, unknown>): FileDiff | null {
  if (Object.keys(patch).length === 0) {
    return null;
  }
  const source = readConfigSource(workspaceRoot, configPath);
  const before = serializeConfigSource(source.raw);
  const after = serializeConfigSource(patchConfigSource(source.raw, patch));
  return { path: configPath, kind: "config", before, after };
}

function buildTextDiffs(workspaceRoot: string, edits: TextEdit[]): FileDiff[] {
  return edits.map((edit) => {
    assertEditablePath(workspaceRoot, edit.path);
    const abs = resolve(workspaceRoot, edit.path);
    const before = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    return { path: edit.path, kind: "text" as const, before, after: edit.content };
  });
}

export function previewEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  payload: EditPayload
): PreviewResult {
  const files: FileDiff[] = [];
  const configDiff = buildConfigDiff(workspaceRoot, configPath, payload.config);
  if (configDiff) {
    files.push(configDiff);
  }
  files.push(...buildTextDiffs(workspaceRoot, payload.text));

  const source = readConfigSource(workspaceRoot, configPath);
  const validation = validateConfig(runtime, patchConfigSource(source.raw, payload.config));
  return { files, validation };
}

export function applyEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  payload: EditPayload
): ApplyResult {
  // Gate 1: config validation
  const source = readConfigSource(workspaceRoot, configPath);
  const patched = patchConfigSource(source.raw, payload.config);
  const validation = validateConfig(runtime, patched);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // Gate 2: protected-zone guard for every target path (throws on violation)
  try {
    if (Object.keys(payload.config).length > 0) {
      assertEditablePath(workspaceRoot, configPath);
    }
    for (const edit of payload.text) {
      assertEditablePath(workspaceRoot, edit.path);
    }
  } catch (error) {
    return { ok: false, errors: [{ message: error instanceof Error ? error.message : String(error) }] };
  }

  // Gate 3: optimistic concurrency for text files
  for (const edit of payload.text) {
    const abs = resolve(workspaceRoot, edit.path);
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (hashContent(current) !== edit.baseHash) {
      return { ok: false, errors: [{ path: edit.path, message: "File changed on disk; reload before applying." }] };
    }
  }

  // Gate 4: atomic writes
  const written: string[] = [];
  if (Object.keys(payload.config).length > 0) {
    writeTextFileAtomic(workspaceRoot, configPath, serializeConfigSource(patched));
    written.push(configPath);
  }
  for (const edit of payload.text) {
    writeTextFileAtomic(workspaceRoot, edit.path, edit.content);
    written.push(edit.path);
  }
  return { ok: true, written };
}
```

- [ ] **Step 3c: Write the barrel `index.ts`**

```ts
// packages/inspector/src/editing/index.ts
export * from "./editable-model.js";
export * from "./config-source.js";
export * from "./provenance.js";
export * from "./text-files.js";
export * from "./diff.js";
export * from "./writer.js";
export * from "./paths.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/writer.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/editing/diff.ts packages/inspector/src/editing/writer.ts packages/inspector/src/editing/index.ts packages/inspector/tests/unit/editing/writer.test.ts
git commit -m "feat(inspector): apply pipeline (validate, guard, concurrency, atomic write)"
```

---

## Task 8: Server endpoints `POST /api/preview` + `/api/apply`

**Files:**
- Modify: `packages/inspector/src/server.ts`
- Modify: `packages/inspector/src/cli/inspect.ts`
- Test: `packages/inspector/tests/unit/editing/server-editing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/server-editing.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { startInspectServer, type InspectServerHandle } from "../../../src/server.js";
import { inspectAgent, defaultStaticDir } from "../../../src/inspector.js";
import { hashContent } from "../../../src/editing/paths.js";

let root: string;
let handle: InspectServerHandle;
const CFG = "config/app-agent.config.json";

beforeEach(async () => {
  // Use the real template workspace as a base, copied so writes are isolated.
  const templateRoot = resolve(process.cwd(), "../template");
  root = mkdtempSync(join(tmpdir(), "inspector-srv-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(join(root, CFG),
    readFileSync(join(templateRoot, "config/app-agent.config.json"), "utf-8"), "utf-8");
  const runtime = await loadTemplateRuntime();
  const spec = await inspectAgent({ workspaceRoot: root, configPath: CFG });
  handle = await startInspectServer({
    spec, staticDir: defaultStaticDir(), port: 7400, portRangeEnd: 7450,
    editing: { runtime, workspaceRoot: root, configPath: CFG },
  });
});
afterEach(async () => {
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

describe("editing endpoints", () => {
  it("POST /api/preview returns a config diff", async () => {
    const res = await fetch(`${handle.url}/api/preview`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "model.name": "gpt-4o" }, text: [] }),
    });
    const body = await res.json();
    expect(body.validation.ok).toBe(true);
    expect(body.files[0].after).toContain("gpt-4o");
  });

  it("POST /api/apply writes and returns a fresh spec", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "agent.name": "renamed-agent" }, text: [] }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.spec.meta.agentName).toBe("renamed-agent");
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).agent.name).toBe("renamed-agent");
  });

  it("POST /api/apply rejects invalid config with 422", async () => {
    const res = await fetch(`${handle.url}/api/apply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { "permissions.mode": "nope" }, text: [] }),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/server-editing.test.ts`
Expected: FAIL — `editing` option unknown / endpoints 404.

- [ ] **Step 3a: Extend `server.ts`**

Add the editing context to options and a body reader, then handle the two POST routes. In `packages/inspector/src/server.ts`:

```ts
// add near the top imports
import type { TemplateRuntime } from "./template-runtime.js";
import type { AgentOrchestrationSpec } from "./types.js";
import { inspectAgent } from "./inspector.js";
import { previewEdits, applyEdits, type EditPayload } from "./editing/writer.js";

// extend InspectServerOptions
export interface InspectServerOptions {
  spec: AgentOrchestrationSpec;
  port?: number;
  portRangeEnd?: number;
  staticDir: string;
  editing?: { runtime: TemplateRuntime; workspaceRoot: string; configPath: string };
}
```

Pass `options.editing` into `createInspectHttpServer(options.spec, options.staticDir, options.editing)` and update its signature. Inside the request handler, before the static-file branch:

```ts
    if (req.method === "POST" && (url.pathname === "/api/preview" || url.pathname === "/api/apply")) {
      if (!editing) {
        res.writeHead(404); res.end("Editing not enabled"); return;
      }
      readJsonBody(req).then((payload: EditPayload) => {
        if (url.pathname === "/api/preview") {
          const preview = previewEdits(editing.runtime, editing.workspaceRoot, editing.configPath, payload);
          sendJson(res, preview.validation.ok ? 200 : 422, preview);
          return;
        }
        const result = applyEdits(editing.runtime, editing.workspaceRoot, editing.configPath, payload);
        if (!result.ok) { sendJson(res, 422, result); return; }
        inspectAgent({ workspaceRoot: editing.workspaceRoot, configPath: editing.configPath })
          .then((spec) => sendJson(res, 200, { ...result, spec }))
          .catch((err) => sendJson(res, 500, { ok: false, errors: [{ message: String(err) }] }));
      }).catch((err) => sendJson(res, 400, { ok: false, errors: [{ message: String(err) }] }));
      return;
    }
```

Add helpers at the bottom of the file:

```ts
function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}")); }
      catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}
```

- [ ] **Step 3b: Wire the CLI** (`packages/inspector/src/cli/inspect.ts`)

In `main()`, after computing `spec` and before `startInspectServer`, load the runtime and pass the editing context (only in dry-run/full, always available):

```ts
  const runtime = await loadTemplateRuntime();
  const server = await startInspectServer({
    spec,
    port: options.port,
    staticDir: defaultStaticDir(),
    editing: {
      runtime,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      configPath: options.configPath ?? "config/app-agent.config.json",
    },
  });
```

Add the import at the top: `import { loadTemplateRuntime } from "../template-runtime.js";`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/server-editing.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/server.ts packages/inspector/src/cli/inspect.ts packages/inspector/tests/unit/editing/server-editing.test.ts
git commit -m "feat(inspector): /api/preview and /api/apply editing endpoints"
```

---

## Task 9: Attach `editable` block to the spec (types + projection)

**Files:**
- Modify: `packages/inspector/src/types.ts`
- Modify: `packages/inspector/src/inspector.ts`
- Test: `packages/inspector/tests/unit/editing/editable-projection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/editable-projection.test.ts
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectAgent } from "../../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../template");

describe("editable projection", () => {
  it("includes an editable block with fields and provenance", async () => {
    const spec = await inspectAgent({ workspaceRoot: templateRoot, configPath: "config/app-agent.config.json" });
    expect(spec.editable).toBeDefined();
    const modelName = spec.editable!.fields.find((f) => f.configPath === "model.name");
    expect(modelName).toBeDefined();
    expect(modelName!.type).toBe("string");
    expect(typeof modelName!.overridden).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-projection.test.ts`
Expected: FAIL — `spec.editable` undefined.

- [ ] **Step 3a: Extend `types.ts`**

Add to `packages/inspector/src/types.ts`:

```ts
export interface EditableFieldSpec {
  id: string;
  section: string;
  configPath: string;
  type: "enum" | "number" | "string" | "boolean" | "string[]";
  label: string;
  enumValues?: string[];
  min?: number;
  max?: number;
  sourceValue: unknown;
  effectiveValue: unknown;
  overridden: boolean;
}

export interface EditableSpec {
  configPath: string;
  fields: EditableFieldSpec[];
}
```

And add `editable: EditableSpec | null;` to the `AgentOrchestrationSpec` interface.

- [ ] **Step 3b: Project it in `inspector.ts`**

Add an import:

```ts
import { EDITABLE_CONFIG_FIELDS } from "./editing/editable-model.js";
import { readConfigSource } from "./editing/config-source.js";
import { computeProvenance } from "./editing/provenance.js";
```

Add a helper and call it in `assembleSpec` (set `editable:` in the returned object):

```ts
function projectEditable(workspaceRoot: string, configPath: string, merged: AppConfig) {
  const source = readConfigSource(workspaceRoot, configPath);
  const provenance = computeProvenance(source.raw, merged as unknown as Record<string, unknown>, EDITABLE_CONFIG_FIELDS);
  const byPath = new Map(provenance.map((p) => [p.configPath, p]));
  return {
    configPath,
    fields: EDITABLE_CONFIG_FIELDS.map((field) => {
      const p = byPath.get(field.configPath)!;
      return { ...field, sourceValue: p.sourceValue, effectiveValue: p.effectiveValue, overridden: p.overridden };
    }),
  };
}
```

In `assembleSpec`, add `editable: projectEditable(input.workspaceRoot, input.configPath ?? "config/app-agent.config.json", input.config),` to the returned spec object. Thread `configPath` into `AssembleSpecInput` (it is already available in `inspectAgent` as `options.configPath`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-projection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/types.ts packages/inspector/src/inspector.ts packages/inspector/tests/unit/editing/editable-projection.test.ts
git commit -m "feat(inspector): attach editable block (fields + provenance) to spec"
```

---

## Task 10: Full suite + typecheck green

**Files:** none (verification)

- [ ] **Step 1: Run the full inspector suite**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run`
Expected: PASS — the original 6 tests plus all new editing tests; no regressions.

- [ ] **Step 2: Typecheck**

Run: `cd packages/inspector && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke the API by hand (optional)**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx tsx src/cli/inspect.ts --workspace ../template --no-open --port 7322 &`
then: `curl -s localhost:7322/api/spec | head -c 200` and `curl -s -XPOST localhost:7322/api/preview -d '{"config":{"model.name":"x"},"text":[]}'`
Expected: spec JSON includes an `editable` block; preview returns a config diff. Kill the server when done.

- [ ] **Step 4: Commit (if any doc/notes changed)**

```bash
git add -A packages/inspector
git commit -m "test(inspector): editing backend suite green" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** editable-model (Task 3) ✓; source-edit + Zod (Task 5) ✓; provenance/badge data (Task 6, Task 9) ✓; protected-zone guard (Task 4, gate 2 Task 7) ✓; optimistic concurrency (gate 3 Task 7) ✓; atomic write (gate 4 Task 7) ✓; preview-diff (Task 7, Task 8) ✓; endpoints + reload (Task 8) ✓; `editable` block in spec (Task 9) ✓; regression of read-only path (Task 10) ✓. **UI (spec "UI" section) is intentionally deferred to Plan 2.**
- **Type consistency:** `EditPayload`/`TextEdit` defined in `writer.ts` and reused by the server; `EditableField` (editable-model) projected to `EditableFieldSpec` (types) in Task 9; `ValidationResult`/`FieldError` from `config-source.ts` reused by `writer.ts`.
- **Out of scope here (Plan 2):** the `web/graph-ui` config-derived graph, right editor panel, diff modal, env-override badges — they consume `GET /api/spec` (`editable` block) + `POST /api/preview|apply` built here.
```
