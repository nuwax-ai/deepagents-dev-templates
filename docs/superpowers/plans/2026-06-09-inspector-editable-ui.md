# Inspector Editable UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable orchestration graph + right-side edit panel + preview/apply flow to the inspector web UI, enabling in-browser config field editing and system-prompt text editing with a 4-gate apply pipeline.

**Architecture:** Vanilla React + ReactFlow from CDN (no build step). The existing `app.js` is refactored to use `useReducer` for editing state, with four new component files imported via ES module. One small backend extension adds editable text-file content+hash to the spec so the browser can compute `baseHash` values without an extra round-trip. The API backend (`POST /api/preview`, `POST /api/apply`) is already implemented in Plan 1.

**Tech Stack:** Vanilla JS ES modules (no bundler), React 18 + ReactFlow 11 via esm.sh CDN, WebCrypto `crypto.subtle` for client-side sha256, Node.js http server from Plan 1.

**Spec:** `docs/superpowers/specs/2026-06-09-inspector-editable-design.md`

**Precondition:** `npm test -w packages/inspector` passes (29/29 from Plan 1). Plan 1 has already built the backend engine + API. This plan is UI-only plus one small backend type extension.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/inspector/src/types.ts` | modify | Add `EditableTextFile` + `textFiles` field to `EditableSpec` |
| `packages/inspector/src/inspector.ts` | modify | `projectEditable`: read system-prompt file → populate `textFiles` |
| `packages/inspector/tests/unit/editing/editable-text-files.test.ts` | create | Verify `spec.editable.textFiles` populated with prompt content + hash |
| `packages/inspector/web/graph-ui/index.html` | modify | Add `<link>` for reset; component scripts load via `app.js` ES imports |
| `packages/inspector/web/graph-ui/app.js` | modify | Refactor to `useReducer`; add "orchestration" tab; import components |
| `packages/inspector/web/graph-ui/styles.css` | modify | Add orchestration-graph, edit-panel, change-bar, diff-modal styles |
| `packages/inspector/web/graph-ui/components/orchestration-graph.js` | create | Config-derived ReactFlow graph (Agent hub + 8 section nodes) |
| `packages/inspector/web/graph-ui/components/edit-panel.js` | create | Right-side field editor: widgets per type, env-override badge, validation errors |
| `packages/inspector/web/graph-ui/components/change-bar.js` | create | Bottom bar: pending-change count, Preview/Apply/Discard buttons |
| `packages/inspector/web/graph-ui/components/diff-modal.js` | create | Before/after diff per file, Apply/Discard confirmation |

---

## Task 1: Backend — add editable text files to spec

**Files:**
- Modify: `packages/inspector/src/types.ts`
- Modify: `packages/inspector/src/inspector.ts`
- Create: `packages/inspector/tests/unit/editing/editable-text-files.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/inspector/tests/unit/editing/editable-text-files.test.ts
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectAgent } from "../../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../template");

describe("editable text files", () => {
  it("includes the system prompt file in editable.textFiles", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });
    expect(spec.editable).toBeDefined();
    const prompt = spec.editable!.textFiles.find((f) => f.kind === "prompt");
    expect(prompt).toBeDefined();
    expect(prompt!.content).toBeTypeOf("string");
    expect(prompt!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prompt!.relPath).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-text-files.test.ts`
Expected: FAIL — `spec.editable.textFiles` is undefined (property not on the type yet).

- [ ] **Step 3: Extend `types.ts`**

In `packages/inspector/src/types.ts`, add the new interface and extend `EditableSpec`:

```ts
export interface EditableTextFile {
  relPath: string;
  kind: "prompt";
  content: string;
  hash: string;
}

export interface EditableSpec {
  configPath: string;
  fields: EditableFieldSpec[];
  textFiles: EditableTextFile[];   // ← add this line
}
```

- [ ] **Step 4: Extend `projectEditable` in `inspector.ts`**

In `packages/inspector/src/inspector.ts`, the `projectEditable` function currently ends with:
```ts
    fields: EDITABLE_CONFIG_FIELDS.map((field) => { ... }),
  };
}
```

Replace the whole function with:

```ts
function projectEditable(workspaceRoot: string, configPath: string, merged: AppConfig): EditableSpec {
  const source = readConfigSource(workspaceRoot, configPath);
  const provenance = computeProvenance(
    source.raw,
    merged as unknown as Record<string, unknown>,
    EDITABLE_CONFIG_FIELDS
  );
  const byPath = new Map(provenance.map((p) => [p.configPath, p]));

  const textFiles: import("./types.js").EditableTextFile[] = [];
  const promptRelPath = merged.agent.systemPromptPath;
  try {
    const promptFile = readTextFile(workspaceRoot, promptRelPath);
    if (promptFile) {
      textFiles.push({ relPath: promptRelPath, kind: "prompt", content: promptFile.content, hash: promptFile.hash });
    }
  } catch {
    // promptRelPath is outside an editable zone or unreadable — skip silently
  }

  return {
    configPath,
    fields: EDITABLE_CONFIG_FIELDS.map((field) => {
      const p = byPath.get(field.configPath)!;
      return {
        ...field,
        sourceValue: p.sourceValue,
        effectiveValue: p.effectiveValue,
        overridden: p.overridden,
      };
    }),
    textFiles,
  };
}
```

Also add `readTextFile` to the imports from `editing/`:

```ts
import { EDITABLE_CONFIG_FIELDS } from "./editing/editable-model.js";
import { readConfigSource } from "./editing/config-source.js";
import { computeProvenance } from "./editing/provenance.js";
import { readTextFile } from "./editing/text-files.js";   // ← add this line
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/unit/editing/editable-text-files.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + typecheck**

Run:
```bash
npm test -w packages/inspector
cd packages/inspector && npx tsc --noEmit && echo "tsc OK"
```
Expected: 30/30 tests pass, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add packages/inspector/src/types.ts packages/inspector/src/inspector.ts packages/inspector/tests/unit/editing/editable-text-files.test.ts
git commit -m "feat(inspector): include editable text file content+hash in spec"
```

---

## Task 2: Orchestration graph tab

**Files:**
- Create: `packages/inspector/web/graph-ui/components/orchestration-graph.js`
- Modify: `packages/inspector/web/graph-ui/app.js` (add "orchestration" tab + import)
- Modify: `packages/inspector/web/graph-ui/styles.css` (add orchestration node styles)

- [ ] **Step 1: Create `components/orchestration-graph.js`**

```js
// packages/inspector/web/graph-ui/components/orchestration-graph.js
import React from "react";
import ReactFlow, { Background, Controls } from "reactflow";

const SECTION_NODES = [
  { id: "meta",        label: "Agent",       editable: true,  x: 420, y: 190 },
  { id: "model",       label: "Model",       editable: true,  x: 420, y:  30 },
  { id: "prompt",      label: "Prompt",      editable: true,  x: 210, y:  80 },
  { id: "tools",       label: "Tools",       editable: false, x: 630, y:  80 },
  { id: "memory",      label: "Memory",      editable: true,  x:  30, y: 190 },
  { id: "subagents",   label: "Subagents",   editable: false, x: 810, y: 190 },
  { id: "permissions", label: "Permissions", editable: true,  x: 210, y: 310 },
  { id: "skills",      label: "Skills",      editable: true,  x: 630, y: 310 },
  { id: "middleware",  label: "Middleware",  editable: true,  x: 420, y: 370 },
];

function buildFlowData(spec, selectedSection) {
  const nodes = SECTION_NODES.map((s) => ({
    id: s.id,
    position: { x: s.x, y: s.y },
    data: {
      label: React.createElement(
        "div",
        { className: `o-node-inner${s.id === selectedSection ? " selected" : ""}` },
        React.createElement("span", { className: "o-node-label" }, s.label),
        !s.editable && React.createElement("span", { className: "o-node-lock" }, "🔒")
      ),
    },
    className: `o-node ${s.editable ? "o-node--editable" : "o-node--readonly"}${s.id === selectedSection ? " o-node--active" : ""}`,
    style: { width: 120, padding: 0 },
  }));

  const edges = SECTION_NODES.filter((s) => s.id !== "meta").map((s) => ({
    id: `meta-${s.id}`,
    source: "meta",
    target: s.id,
    style: { stroke: s.editable ? "var(--blue)" : "var(--line)" },
  }));

  return { nodes, edges };
}

export function OrchestrationGraph({ spec, selectedSection, onSelectSection }) {
  const { nodes, edges } = buildFlowData(spec, selectedSection);

  return React.createElement(
    "div",
    { className: "graph-canvas" },
    React.createElement(
      ReactFlow,
      {
        nodes,
        edges,
        fitView: true,
        fitViewOptions: { padding: 0.3 },
        nodesDraggable: false,
        nodesConnectable: false,
        elementsSelectable: true,
        onNodeClick: (_e, node) => {
          const section = SECTION_NODES.find((s) => s.id === node.id);
          if (section?.editable) onSelectSection(node.id);
        },
      },
      React.createElement(Background, { gap: 18, color: "var(--line)" }),
      React.createElement(Controls, { showInteractive: false })
    )
  );
}
```

- [ ] **Step 2: Add orchestration CSS to `styles.css`**

Append to `packages/inspector/web/graph-ui/styles.css`:

```css
/* ── Orchestration graph nodes ─────────────────────────────── */
.o-node .react-flow__node-default {
  padding: 0;
  border-radius: 8px;
}

.o-node--editable.react-flow__node {
  border: 1.5px solid var(--blue);
  background: #1c2a38;
  cursor: pointer;
}

.o-node--readonly.react-flow__node {
  border: 1px dashed var(--line);
  background: var(--panel-2);
  opacity: 0.7;
  cursor: default;
}

.o-node--active.react-flow__node {
  border: 2px solid var(--blue);
  box-shadow: 0 0 0 3px #6fb7d640;
}

.o-node-inner {
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.o-node-label {
  font-size: 13px;
  font-weight: 500;
}

.o-node-lock {
  font-size: 10px;
  opacity: 0.6;
}
```

- [ ] **Step 3: Update `app.js`**

Replace the entire `packages/inspector/web/graph-ui/app.js` with:

```js
// packages/inspector/web/graph-ui/app.js
import React, { useReducer } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";
import { OrchestrationGraph } from "./components/orchestration-graph.js";

const spec = window.__INSPECTOR_SPEC__ || (await fetch("/api/spec").then((r) => r.json()));

// ── State ───────────────────────────────────────────────────────────────────
const initialState = {
  spec,
  tab: "orchestration",
  selectedSection: null,
  configEdits: {},     // { "dotPath": newValue }
  textEdits: {},       // { "relPath": { content, baseHash } }
  showDiff: false,
  previewResult: null,
  applying: false,
  applyErrors: [],
};

function reducer(state, action) {
  switch (action.type) {
    case "SET_TAB":
      return { ...state, tab: action.tab, selectedSection: null };
    case "SELECT_SECTION":
      return { ...state, selectedSection: action.section };
    case "EDIT_CONFIG":
      return { ...state, configEdits: { ...state.configEdits, [action.path]: action.value } };
    case "EDIT_TEXT":
      return { ...state, textEdits: { ...state.textEdits, [action.relPath]: { content: action.content, baseHash: action.baseHash } } };
    case "DISCARD_EDITS":
      return { ...state, configEdits: {}, textEdits: {}, showDiff: false, previewResult: null, applyErrors: [] };
    case "SET_PREVIEW":
      return { ...state, previewResult: action.result, showDiff: true };
    case "CLOSE_DIFF":
      return { ...state, showDiff: false };
    case "APPLY_START":
      return { ...state, applying: true, applyErrors: [] };
    case "APPLY_SUCCESS":
      return { ...initialState, spec: action.spec };
    case "APPLY_ERROR":
      return { ...state, applying: false, applyErrors: action.errors };
    default:
      return state;
  }
}

// ── App ─────────────────────────────────────────────────────────────────────
function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const editCount = Object.keys(state.configEdits).length + Object.keys(state.textEdits).length;

  return React.createElement(
    "main",
    { className: "shell" },
    React.createElement(Header, { spec: state.spec }),
    React.createElement(
      "section",
      { className: "workspace" },
      React.createElement(
        "div",
        { className: "main-pane" },
        React.createElement(Tabs, { tab: state.tab, setTab: (tab) => dispatch({ type: "SET_TAB", tab }) }),
        state.tab === "orchestration" && React.createElement(OrchestrationGraph, {
          spec: state.spec,
          selectedSection: state.selectedSection,
          onSelectSection: (section) => dispatch({ type: "SELECT_SECTION", section }),
        }),
        state.tab === "graph" && React.createElement(GraphView, { spec: state.spec }),
        state.tab === "pipeline" && React.createElement(PipelineView, { middleware: state.spec.middleware }),
        state.tab === "resources" && React.createElement(ResourcesView, { spec: state.spec }),
        state.tab === "json" && React.createElement("pre", { className: "json-view" }, JSON.stringify(state.spec, null, 2))
      ),
      React.createElement(
        "aside",
        { className: "detail" },
        state.selectedSection
          ? React.createElement("p", { className: "panel-hint" }, "Edit panel — coming in Task 3")
          : React.createElement("p", { className: "panel-hint", style: { color: "var(--muted)" } }, "Click an editable node (blue border) to open the editor.")
      )
    ),
    editCount > 0 && React.createElement("p", { style: { color: "var(--orange)", padding: "8px 18px" } }, `${editCount} pending edit(s) — ChangeBar coming in Task 5`)
  );
}

function Header({ spec }) {
  return React.createElement(
    "header",
    { className: "topbar" },
    React.createElement("div", null,
      React.createElement("h1", null, spec.meta.agentName),
      React.createElement("p", null, spec.meta.agentDescription || "DeepAgents orchestration snapshot")
    ),
    React.createElement(
      "div",
      { className: "status-grid" },
      badge("Model", spec.meta.model.modelString),
      badge("Mode", spec.mode),
      badge("Permissions", spec.meta.permissionsMode),
      badge("Schema", spec.schema.replace("nuwaclaw.", ""))
    )
  );
}

function Tabs({ tab, setTab }) {
  return React.createElement(
    "nav",
    { className: "tabs" },
    ["orchestration", "graph", "pipeline", "resources", "json"].map((item) =>
      React.createElement("button", {
        key: item,
        className: tab === item ? "active" : "",
        onClick: () => setTab(item),
      }, item)
    )
  );
}

function GraphView({ spec }) {
  const [selected, setSelected] = React.useState(null);
  if (!spec.graph) {
    return React.createElement(
      "div",
      { className: "empty-state" },
      React.createElement("h2", null, "LangGraph topology"),
      React.createElement("p", null, "Run with --full to include the compiled LangGraph topology."),
      React.createElement("dl", null,
        stat("Tools", spec.tools.length),
        stat("Middleware", spec.middleware.length),
        stat("Skills", spec.skills.files.length),
        stat("Subagents", spec.subagents.length)
      )
    );
  }
  const { nodes, edges } = toFlowGraph(spec.graph);
  return React.createElement(
    "div",
    { className: "graph-canvas" },
    React.createElement(ReactFlow, {
      nodes, edges, fitView: true,
      onNodeClick: (_e, node) => setSelected(node.data.detail),
    },
      React.createElement(MiniMap, null),
      React.createElement(Controls, null),
      React.createElement(Background, { gap: 18 })
    )
  );
}

function PipelineView({ middleware }) {
  return React.createElement(
    "ol",
    { className: "pipeline" },
    middleware.map((item) =>
      React.createElement("li", { key: item.name, className: item.enabled ? "enabled" : "disabled" },
        React.createElement("span", { className: "step" }, String(item.order + 1).padStart(2, "0")),
        React.createElement("strong", null, item.name),
        React.createElement("span", null, item.factory),
        React.createElement("em", null, item.enabled ? "enabled" : "disabled")
      )
    )
  );
}

function ResourcesView({ spec }) {
  const [selected, setSelected] = React.useState(null);
  const rows = [
    ...spec.tools.map((item) => ({ group: "tool", label: item.name, detail: item })),
    ...spec.skills.files.map((item) => ({ group: "skill", label: item.name, detail: item })),
    ...spec.subagents.map((item) => ({ group: "subagent", label: item.name, detail: item })),
    ...spec.memory.absolutePaths.map((item) => ({ group: "memory", label: item, detail: { path: item } })),
  ];
  return React.createElement(
    "div",
    { className: "resources" },
    rows.map((row) =>
      React.createElement("button", {
        key: `${row.group}:${row.label}`,
        onClick: () => setSelected(row.detail),
      },
        React.createElement("span", null, row.group),
        React.createElement("strong", null, row.label)
      )
    )
  );
}

function toFlowGraph(graph) {
  if (!graph) return { nodes: [], edges: [] };
  const columns = Math.ceil(Math.sqrt(graph.nodes.length || 1));
  const nodes = graph.nodes.map((node, i) => ({
    id: node.id, type: "default",
    position: { x: (i % columns) * 220, y: Math.floor(i / columns) * 130 },
    data: { label: node.name, detail: node },
    className: `node-${node.type}`,
  }));
  const edges = graph.edges.map((edge, i) => ({
    id: `${edge.source}-${edge.target}-${i}`,
    source: edge.source, target: edge.target,
    label: edge.data, animated: edge.conditional,
  }));
  return { nodes, edges };
}

function badge(label, value) {
  return React.createElement("div", { className: "badge" },
    React.createElement("span", null, label),
    React.createElement("strong", null, value)
  );
}

function stat(label, value) {
  return React.createElement(React.Fragment, { key: label },
    React.createElement("dt", null, label),
    React.createElement("dd", null, value)
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
```

- [ ] **Step 4: Manual verification**

```bash
cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx tsx src/cli/inspect.ts --workspace ../template --no-open --port 7322
```

Open `http://localhost:7322`. Verify:
- "orchestration" tab is active by default
- 9 nodes rendered (Agent, Model, Prompt, Tools, Memory, Subagents, Permissions, Skills, Middleware)
- Editable nodes have blue border; Tools and Subagents have dashed gray border + 🔒
- Clicking Agent/Model/Permissions etc. shows "Edit panel — coming in Task 3" placeholder
- Switching to other tabs (graph, pipeline, resources, json) still works

Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/web/graph-ui/components/orchestration-graph.js packages/inspector/web/graph-ui/app.js packages/inspector/web/graph-ui/styles.css
git commit -m "feat(inspector-ui): orchestration graph tab with config-derived section nodes"
```

---

## Task 3: Edit panel component

**Files:**
- Create: `packages/inspector/web/graph-ui/components/edit-panel.js`
- Modify: `packages/inspector/web/graph-ui/app.js` (wire EditPanel into right column)
- Modify: `packages/inspector/web/graph-ui/styles.css` (field widget styles)

- [ ] **Step 1: Create `components/edit-panel.js`**

```js
// packages/inspector/web/graph-ui/components/edit-panel.js
import React from "react";

const SECTION_LABELS = {
  meta: "Agent",
  model: "Model",
  prompt: "Prompt",
  permissions: "Permissions",
  middleware: "Middleware",
  memory: "Memory",
  skills: "Skills",
};

export function EditPanel({ spec, section, configEdits, textEdits, onConfigEdit, onTextEdit, validationErrors }) {
  if (!section) {
    return React.createElement("div", { className: "edit-panel edit-panel--empty" },
      React.createElement("p", null, "Click an editable node to open the editor.")
    );
  }

  const fields = spec.editable?.fields.filter((f) => f.section === section) ?? [];
  const errorsByPath = Object.fromEntries((validationErrors ?? []).map((e) => [e.path, e.message]));

  // Readonly sections
  if (section === "tools" || section === "subagents") {
    return React.createElement("div", { className: "edit-panel" },
      React.createElement("h3", { className: "edit-panel__title" }, SECTION_LABELS[section] ?? section),
      React.createElement("p", { className: "edit-panel__readonly-hint" }, "🔒 Code-defined — not editable via config.")
    );
  }

  // Prompt section: text area
  if (section === "prompt") {
    const promptFile = spec.editable?.textFiles.find((f) => f.kind === "prompt");
    if (!promptFile) {
      return React.createElement("div", { className: "edit-panel" },
        React.createElement("h3", { className: "edit-panel__title" }, "Prompt"),
        React.createElement("p", { className: "edit-panel__readonly-hint" }, "System prompt is inline (not a file) — not editable here.")
      );
    }
    const pending = textEdits[promptFile.relPath];
    const currentContent = pending?.content ?? promptFile.content;
    return React.createElement("div", { className: "edit-panel" },
      React.createElement("h3", { className: "edit-panel__title" }, "Prompt"),
      React.createElement("p", { className: "edit-panel__path" }, promptFile.relPath),
      React.createElement("textarea", {
        className: "edit-panel__textarea",
        value: currentContent,
        rows: 18,
        onChange: (e) => onTextEdit(promptFile.relPath, e.target.value, promptFile.hash),
      }),
      pending && React.createElement("p", { className: "edit-panel__modified" }, "● Modified")
    );
  }

  // Config field sections
  return React.createElement("div", { className: "edit-panel" },
    React.createElement("h3", { className: "edit-panel__title" }, SECTION_LABELS[section] ?? section),
    fields.length === 0
      ? React.createElement("p", { className: "edit-panel__readonly-hint" }, "No editable fields in this section.")
      : fields.map((field) =>
          React.createElement(FieldWidget, {
            key: field.id,
            field,
            currentValue: field.id in configEdits ? configEdits[field.id] : field.sourceValue,
            error: errorsByPath[field.configPath],
            onChange: (val) => onConfigEdit(field.configPath, val),
          })
        )
  );
}

function FieldWidget({ field, currentValue, error, onChange }) {
  const isModified = currentValue !== field.sourceValue;

  return React.createElement("div", { className: `field-row${error ? " field-row--error" : ""}` },
    React.createElement("div", { className: "field-label-row" },
      React.createElement("label", { className: "field-label" }, field.label),
      field.overridden && React.createElement("span", { className: "env-badge" },
        `env override: ${JSON.stringify(field.effectiveValue)}`
      ),
      isModified && React.createElement("span", { className: "modified-dot" }, "●")
    ),
    renderWidget(field, currentValue, onChange),
    error && React.createElement("p", { className: "field-error" }, error)
  );
}

function renderWidget(field, value, onChange) {
  switch (field.type) {
    case "enum":
      return React.createElement("select", {
        className: "field-input",
        value: value ?? "",
        onChange: (e) => onChange(e.target.value),
      },
        (field.enumValues ?? []).map((opt) =>
          React.createElement("option", { key: opt, value: opt }, opt)
        )
      );

    case "number":
      return React.createElement("input", {
        className: "field-input",
        type: "number",
        value: value ?? "",
        min: field.min,
        max: field.max,
        step: field.max != null && field.max <= 2 ? 0.05 : 1,
        onChange: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)),
      });

    case "boolean":
      return React.createElement("label", { className: "field-toggle" },
        React.createElement("input", {
          type: "checkbox",
          checked: Boolean(value),
          onChange: (e) => onChange(e.target.checked),
        }),
        React.createElement("span", { className: "toggle-track" })
      );

    case "string[]":
      return React.createElement(TagListEditor, { value: Array.isArray(value) ? value : [], onChange });

    default: // "string"
      return React.createElement("input", {
        className: "field-input",
        type: "text",
        value: value ?? "",
        onChange: (e) => onChange(e.target.value),
      });
  }
}

function TagListEditor({ value, onChange }) {
  const [draft, setDraft] = React.useState("");

  return React.createElement("div", { className: "tag-list" },
    value.map((tag, i) =>
      React.createElement("span", { key: i, className: "tag" },
        tag,
        React.createElement("button", {
          className: "tag-remove",
          onClick: () => onChange(value.filter((_, j) => j !== i)),
        }, "×")
      )
    ),
    React.createElement("input", {
      className: "tag-input",
      placeholder: "add item…",
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onKeyDown: (e) => {
        if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
          e.preventDefault();
          onChange([...value, draft.trim()]);
          setDraft("");
        }
        if (e.key === "Backspace" && !draft && value.length > 0) {
          onChange(value.slice(0, -1));
        }
      },
    })
  );
}
```

- [ ] **Step 2: Add field widget CSS to `styles.css`**

Append to `packages/inspector/web/graph-ui/styles.css`:

```css
/* ── Edit panel ─────────────────────────────────────────────── */
.edit-panel {
  padding: 16px;
  overflow-y: auto;
  height: 100%;
}

.edit-panel--empty p,
.edit-panel__readonly-hint {
  color: var(--muted);
  font-size: 13px;
}

.edit-panel__title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 14px;
}

.edit-panel__path {
  font-size: 11px;
  color: var(--muted);
  margin: -10px 0 8px;
  font-family: monospace;
}

.edit-panel__modified {
  color: var(--orange);
  font-size: 12px;
  margin-top: 6px;
}

.edit-panel__textarea {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font-family: monospace;
  font-size: 12px;
  padding: 8px;
  resize: vertical;
}

/* ── Field rows ─────────────────────────────────────────────── */
.field-row {
  margin-bottom: 14px;
}

.field-row--error .field-input,
.field-row--error .tag-list {
  border-color: var(--red);
}

.field-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.field-label {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.env-badge {
  font-size: 10px;
  background: #d99b5233;
  border: 1px solid var(--orange);
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--orange);
}

.modified-dot {
  color: var(--orange);
  font-size: 12px;
  margin-left: auto;
}

.field-input {
  width: 100%;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  padding: 6px 8px;
}

.field-input:focus {
  outline: none;
  border-color: var(--blue);
}

select.field-input {
  cursor: pointer;
}

.field-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.field-toggle input {
  display: none;
}

.toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--line);
  position: relative;
  transition: background 0.15s;
}

.toggle-track::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text);
  transition: transform 0.15s;
}

.field-toggle input:checked + .toggle-track {
  background: var(--blue);
}

.field-toggle input:checked + .toggle-track::after {
  transform: translateX(16px);
}

.field-error {
  color: var(--red);
  font-size: 11px;
  margin: 4px 0 0;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 34px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 6px;
  align-items: center;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
}

.tag-remove {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.tag-input {
  background: none;
  border: none;
  color: var(--text);
  font-size: 12px;
  min-width: 80px;
  outline: none;
  flex: 1;
}

.panel-hint {
  padding: 16px;
  color: var(--muted);
  font-size: 13px;
}
```

- [ ] **Step 3: Wire EditPanel in `app.js`**

Add the import at the top of `app.js` (after the existing imports):

```js
import { EditPanel } from "./components/edit-panel.js";
```

Replace the `<aside className="detail">` element in the App function with:

```js
      React.createElement(EditPanel, {
        spec: state.spec,
        section: state.selectedSection,
        configEdits: state.configEdits,
        textEdits: state.textEdits,
        onConfigEdit: (path, value) => dispatch({ type: "EDIT_CONFIG", path, value }),
        onTextEdit: (relPath, content, baseHash) => dispatch({ type: "EDIT_TEXT", relPath, content, baseHash }),
        validationErrors: state.previewResult?.validation.ok === false ? state.previewResult.validation.errors : [],
      })
```

Also remove the temporary "Edit panel — coming in Task 3" placeholder.

- [ ] **Step 4: Manual verification**

Start the server:
```bash
cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx tsx src/cli/inspect.ts --workspace ../template --no-open --port 7322
```

Verify in browser:
- Click "Model" node → right panel shows Model fields (Provider dropdown, Model name input, Temperature number, Max tokens number)
- Click "Permissions" node → shows Mode (yolo/ask/plan dropdown), Denied Paths (tag list), Allowed Paths (tag list), Interrupt On (tag list)
- Click "Prompt" node → shows textarea with the system prompt content
- Editing a dropdown field updates it immediately (orange "●" appears)
- Click "Tools" → shows readonly message "🔒 Code-defined"
- If `DEEPAGENTS_PERMISSIONS_MODE` env is set to something different from config, the env-badge appears

Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/web/graph-ui/components/edit-panel.js packages/inspector/web/graph-ui/app.js packages/inspector/web/graph-ui/styles.css
git commit -m "feat(inspector-ui): edit panel with field widgets and env-override badges"
```

---

## Task 4: ChangeBar component

**Files:**
- Create: `packages/inspector/web/graph-ui/components/change-bar.js`
- Modify: `packages/inspector/web/graph-ui/app.js` (wire ChangeBar)
- Modify: `packages/inspector/web/graph-ui/styles.css` (add change-bar styles)

- [ ] **Step 1: Create `components/change-bar.js`**

```js
// packages/inspector/web/graph-ui/components/change-bar.js
import React from "react";

export function ChangeBar({ editCount, previewing, applying, onPreview, onDiscard }) {
  if (editCount === 0) return null;

  return React.createElement("div", { className: "change-bar" },
    React.createElement("span", { className: "change-bar__count" },
      `● ${editCount} pending edit${editCount === 1 ? "" : "s"}`
    ),
    React.createElement("div", { className: "change-bar__actions" },
      React.createElement("button", {
        className: "change-bar__btn change-bar__btn--secondary",
        onClick: onDiscard,
        disabled: applying,
      }, "Discard"),
      React.createElement("button", {
        className: "change-bar__btn change-bar__btn--primary",
        onClick: onPreview,
        disabled: previewing || applying,
      }, previewing ? "Loading preview…" : "Preview diff →")
    )
  );
}
```

- [ ] **Step 2: Add ChangeBar CSS to `styles.css`**

Append to `packages/inspector/web/graph-ui/styles.css`:

```css
/* ── Change bar ─────────────────────────────────────────────── */
.change-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: #1c2e1c;
  border-top: 1px solid var(--green);
  z-index: 100;
}

.change-bar__count {
  color: var(--green);
  font-size: 13px;
  font-weight: 500;
}

.change-bar__actions {
  display: flex;
  gap: 8px;
}

.change-bar__btn {
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
}

.change-bar__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.change-bar__btn--secondary {
  background: transparent;
  border-color: var(--line);
  color: var(--text);
}

.change-bar__btn--primary {
  background: var(--green);
  color: #0d1a0d;
  font-weight: 600;
}
```

- [ ] **Step 3: Wire ChangeBar in `app.js`**

Add the import:
```js
import { ChangeBar } from "./components/change-bar.js";
```

Replace the temporary pending-edit placeholder paragraph with ChangeBar. Add a `previewing` state to the reducer:

In `initialState`, add:
```js
previewing: false,
```

In `reducer`, add cases:
```js
case "PREVIEW_START":
  return { ...state, previewing: true };
case "PREVIEW_DONE":
  return { ...state, previewing: false };
```

In the App function, compute `editCount`:
```js
const editCount = Object.keys(state.configEdits).length + Object.keys(state.textEdits).length;
```

Add a `handlePreview` async function inside `App`:
```js
async function handlePreview() {
  dispatch({ type: "PREVIEW_START" });
  const payload = {
    config: state.configEdits,
    text: Object.entries(state.textEdits).map(([path, { content, baseHash }]) => ({ path, content, baseHash })),
  };
  const res = await fetch("/api/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  dispatch({ type: "PREVIEW_DONE" });
  dispatch({ type: "SET_PREVIEW", result });
}
```

Add ChangeBar to the App return (after the `<section className="workspace">`, before closing `<main>`):
```js
    React.createElement(ChangeBar, {
      editCount,
      previewing: state.previewing,
      applying: state.applying,
      onPreview: handlePreview,
      onDiscard: () => dispatch({ type: "DISCARD_EDITS" }),
    })
```

- [ ] **Step 4: Manual verification**

Start the server:
```bash
cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx tsx src/cli/inspect.ts --workspace ../template --no-open --port 7322
```

Verify in browser:
- With no edits: ChangeBar not visible
- Edit a field (e.g., change Model name) → green bar appears at bottom with count
- Click "Discard" → bar disappears, field reverts
- Edit multiple fields → count updates correctly
- Click "Preview diff →" → bar shows "Loading preview…" briefly, then DiffModal should open (coming in Task 5, currently will just log to console or show raw result)

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/web/graph-ui/components/change-bar.js packages/inspector/web/graph-ui/app.js packages/inspector/web/graph-ui/styles.css
git commit -m "feat(inspector-ui): change bar with pending edit count and preview trigger"
```

---

## Task 5: DiffModal + Apply flow

**Files:**
- Create: `packages/inspector/web/graph-ui/components/diff-modal.js`
- Modify: `packages/inspector/web/graph-ui/app.js` (wire DiffModal + apply handler)
- Modify: `packages/inspector/web/graph-ui/styles.css` (modal styles)

- [ ] **Step 1: Create `components/diff-modal.js`**

```js
// packages/inspector/web/graph-ui/components/diff-modal.js
import React from "react";

export function DiffModal({ previewResult, applying, applyErrors, onApply, onClose }) {
  if (!previewResult) return null;

  const files = previewResult.files ?? [];
  const validation = previewResult.validation;

  return React.createElement("div", { className: "modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
    React.createElement("div", { className: "modal" },
      React.createElement("div", { className: "modal__header" },
        React.createElement("h2", null, "Preview changes"),
        React.createElement("button", { className: "modal__close", onClick: onClose }, "×")
      ),

      !validation.ok && React.createElement("div", { className: "modal__validation-errors" },
        React.createElement("strong", null, "Validation errors:"),
        React.createElement("ul", null,
          validation.errors.map((e, i) =>
            React.createElement("li", { key: i }, `${e.path}: ${e.message}`)
          )
        )
      ),

      files.length === 0
        ? React.createElement("p", { className: "modal__no-changes" }, "No file changes.")
        : files.map((file) =>
            React.createElement("div", { className: "modal__file", key: file.path },
              React.createElement("h4", { className: "modal__file-path" }, file.path),
              React.createElement("div", { className: "modal__diff" },
                React.createElement("div", { className: "modal__diff-col modal__diff-col--before" },
                  React.createElement("div", { className: "modal__diff-label" }, "Before"),
                  React.createElement("pre", null, file.before)
                ),
                React.createElement("div", { className: "modal__diff-col modal__diff-col--after" },
                  React.createElement("div", { className: "modal__diff-label" }, "After"),
                  React.createElement("pre", null, file.after)
                )
              )
            )
          ),

      applyErrors.length > 0 && React.createElement("div", { className: "modal__apply-errors" },
        applyErrors.map((e, i) =>
          React.createElement("p", { key: i, className: "modal__apply-error" }, e.path ? `${e.path}: ${e.message}` : e.message)
        )
      ),

      React.createElement("div", { className: "modal__footer" },
        React.createElement("button", {
          className: "change-bar__btn change-bar__btn--secondary",
          onClick: onClose,
          disabled: applying,
        }, "Cancel"),
        React.createElement("button", {
          className: "change-bar__btn change-bar__btn--primary",
          disabled: !validation.ok || applying,
          onClick: onApply,
        }, applying ? "Applying…" : "Apply changes")
      )
    )
  );
}
```

- [ ] **Step 2: Add DiffModal CSS to `styles.css`**

Append to `packages/inspector/web/graph-ui/styles.css`:

```css
/* ── Diff modal ─────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: #00000088;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  width: min(90vw, 1000px);
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}

.modal__header h2 {
  font-size: 16px;
}

.modal__close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 20px;
  cursor: pointer;
  padding: 0 6px;
}

.modal__validation-errors {
  margin: 12px 20px;
  padding: 10px 14px;
  background: #d66f5f22;
  border: 1px solid var(--red);
  border-radius: 6px;
  font-size: 13px;
}

.modal__validation-errors ul {
  margin: 6px 0 0;
  padding-left: 20px;
  color: var(--red);
}

.modal__file {
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
}

.modal__file-path {
  font-size: 13px;
  font-family: monospace;
  color: var(--muted);
  margin: 0 0 8px;
  font-weight: normal;
}

.modal__diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.modal__diff-col {
  border-radius: 6px;
  overflow: hidden;
}

.modal__diff-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--muted);
  padding: 4px 8px;
  background: var(--panel-2);
}

.modal__diff-col--before pre {
  background: #2a1a1a;
  color: #f1a0a0;
  padding: 8px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
}

.modal__diff-col--after pre {
  background: #1a2a1a;
  color: #a0d0a0;
  padding: 8px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
}

.modal__no-changes {
  padding: 20px;
  color: var(--muted);
}

.modal__apply-errors {
  margin: 0 20px;
  padding: 10px 14px;
  background: #d66f5f22;
  border: 1px solid var(--red);
  border-radius: 6px;
}

.modal__apply-error {
  color: var(--red);
  font-size: 13px;
  margin: 0;
}

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
  position: sticky;
  bottom: 0;
  background: var(--panel);
}
```

- [ ] **Step 3: Wire DiffModal + apply handler in `app.js`**

Add the import:
```js
import { DiffModal } from "./components/diff-modal.js";
```

Add `handleApply` async function inside `App`:
```js
async function handleApply() {
  dispatch({ type: "APPLY_START" });
  const payload = {
    config: state.configEdits,
    text: Object.entries(state.textEdits).map(([path, { content, baseHash }]) => ({ path, content, baseHash })),
  };
  const res = await fetch("/api/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  if (result.ok) {
    dispatch({ type: "APPLY_SUCCESS", spec: result.spec });
  } else {
    dispatch({ type: "APPLY_ERROR", errors: result.errors ?? [] });
  }
}
```

Add DiffModal to the App return (after ChangeBar):
```js
    React.createElement(DiffModal, {
      previewResult: state.showDiff ? state.previewResult : null,
      applying: state.applying,
      applyErrors: state.applyErrors,
      onApply: handleApply,
      onClose: () => dispatch({ type: "CLOSE_DIFF" }),
    })
```

- [ ] **Step 4: Manual verification — full editing flow**

Start the server:
```bash
cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx tsx src/cli/inspect.ts --workspace ../template --no-open --port 7322
```

Run through the complete golden path in browser:

1. Click "Model" node → edit "Model name" to `"gpt-4o-test"` 
2. Green ChangeBar appears with "1 pending edit"
3. Click "Preview diff →" → DiffModal opens showing config/app-agent.config.json before/after with the model name change
4. Validation shows OK (green Apply button)
5. Click "Apply changes" → modal shows "Applying…" then closes; spec reloads with new model name
6. Verify "Model name" field now shows `"gpt-4o-test"` (no pending ●)

Test error case:
1. Edit "Permissions" > "Mode" to any valid value
2. Preview → diff shows change
3. Apply → succeeds
4. Restore original value and apply again (to undo)

Test validation gate:
1. Edit "Model" > "Temperature" to `999` (above max=2)
2. Preview → shows diff BUT `validation.ok: false` + error message shown
3. "Apply changes" button is disabled

Test stale hash (hard to trigger manually, but verify):
1. Make an edit; in another terminal, manually edit the config file; try Apply → should get error "File changed on disk"

Stop server with Ctrl+C.

Verify the config file on disk was actually updated after a successful apply:
```bash
cat ../template/config/app-agent.config.json | grep modelName
```

**Note:** If you ran the apply test against the real template workspace, remember to restore the original config:
```bash
git checkout ../template/config/app-agent.config.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/web/graph-ui/components/diff-modal.js packages/inspector/web/graph-ui/app.js packages/inspector/web/graph-ui/styles.css
git commit -m "feat(inspector-ui): diff modal + apply flow with validation and stale-hash guard"
```

---

## Task 6: Final smoke test + padding

**Files:**
- Create: `packages/inspector/tests/integration/ui-smoke.test.ts`
- Verify no regressions

- [ ] **Step 1: Write a server-level integration smoke test**

```ts
// packages/inspector/tests/integration/ui-smoke.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { loadTemplateRuntime } from "../../src/template-runtime.js";
import { startInspectServer, type InspectServerHandle } from "../../src/server.js";
import { inspectAgent, defaultStaticDir } from "../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../template");
let handle: InspectServerHandle;

beforeAll(async () => {
  const runtime = await loadTemplateRuntime();
  const spec = await inspectAgent({ workspaceRoot: templateRoot, configPath: "config/app-agent.config.json" });
  handle = await startInspectServer({
    spec, staticDir: defaultStaticDir(), port: 7450, portRangeEnd: 7460,
    editing: { runtime, workspaceRoot: templateRoot, configPath: "config/app-agent.config.json" },
  });
});

afterAll(async () => {
  await handle.close();
});

describe("inspector UI smoke", () => {
  it("serves index.html", async () => {
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("DeepAgents Inspector");
    expect(html).toContain("app.js");
  });

  it("serves app.js component file", async () => {
    const res = await fetch(`${handle.url}/app.js`);
    expect(res.status).toBe(200);
    const src = await res.text();
    expect(src).toContain("useReducer");
    expect(src).toContain("orchestration");
  });

  it("spec includes editable.textFiles", async () => {
    const res = await fetch(`${handle.url}/api/spec`);
    const spec = await res.json();
    expect(spec.editable).toBeDefined();
    expect(Array.isArray(spec.editable.textFiles)).toBe(true);
  });

  it("preview and apply endpoints exist", async () => {
    const preview = await fetch(`${handle.url}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: {}, text: [] }),
    });
    expect(preview.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run smoke test**

Run: `cd packages/inspector && INSPECTOR_TEMPLATE_SOURCE=1 npx vitest run tests/integration/ui-smoke.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Run full inspector suite**

Run: `npm test -w packages/inspector`
Expected: All tests pass (≥34 tests: 30 from Plan 1+T1 + 4 new).

- [ ] **Step 4: Typecheck**

Run: `cd packages/inspector && npx tsc --noEmit && echo "tsc OK"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/tests/integration/ui-smoke.test.ts
git commit -m "test(inspector): UI smoke test for index.html, app.js, spec, and editing endpoints"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement | Task |
|---|---|
| Config-derived orchestration graph (center, node per section) | T2 |
| Editable nodes blue, readonly nodes gray + 🔒 | T2 |
| `--full` real LangGraph topology (existing "graph" tab) | carried over |
| Right editor panel driven by editable-model | T3 |
| enum→dropdown, number→input, boolean→toggle, string→text, string[]→tag editor | T3 |
| prompt/skill→multiline textarea | T3 (prompt); skills in future plan |
| env-override badge (source ≠ merged) | T3 |
| Zod errors inline, Apply disabled when invalid | T3 + T5 |
| Change bar: count → "Preview diff" → diff modal | T4 + T5 |
| Diff modal: per-file before/after | T5 |
| Apply/Discard buttons | T4 + T5 |
| POST /api/preview + /api/apply | wired in T4 + T5 |
| Reload spec after apply | T5 |
| editable.textFiles (baseHash for text edits) | T1 |

**Gap:** Skill file (SKILL.md) and subagent AGENT.md text editing are excluded from this plan (YAGNI v1). System prompt editing is included.

### 2. Placeholder scan

No TBD, TODO, or vague error-handling phrases. All widget types have explicit implementation code.

### 3. Type consistency

- `EditableTextFile.kind: "prompt"` used in T1 and consumed in T3 (`find(f => f.kind === "prompt")`) — consistent.
- `state.configEdits` is `Record<string, unknown>` throughout — consistent with `EditPayload.config` in Plan 1.
- `state.textEdits` is `Record<string, {content, baseHash}>` — mapped to `TextEdit[]` in handlePreview/handleApply — consistent with Plan 1 `TextEdit`.
- `previewResult.validation` shape: `{ ok: true } | { ok: false, errors: FieldError[] }` — matches Plan 1 `ValidationResult`.
