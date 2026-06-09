import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";

const initialSpec =
  window.__INSPECTOR_SPEC__ || (await fetch("/api/spec").then((r) => r.json()));

// ---------------- helpers ----------------

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function basename(p) {
  if (!p) return "";
  return String(p).split(/[\\/]/).pop();
}

function arrayToString(value) {
  return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
}

function stringToArray(s) {
  return String(s || "")
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function jsonEqual(a, b) {
  return deepEqual(a, b);
}

// ---------------- hooks ----------------

function useTextFile(path) {
  const [state, setState] = useState({ loading: true, content: null, hash: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, content: null, hash: null, error: null });
    if (!path) {
      setState({ loading: false, content: null, hash: null, error: null });
      return () => {};
    }
    fetch(`/api/text?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setState({ loading: false, content: null, hash: null, error: body.errors?.[0]?.message ?? `HTTP ${r.status}` });
        } else {
          setState({ loading: false, content: body.content, hash: body.hash, error: null });
        }
      })
      .catch((err) => !cancelled && setState({ loading: false, content: null, hash: null, error: String(err) }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return state;
}

function useApplyFlow(spec) {
  const [draft, setDraft] = useState(() => ({
    config: {},
    text: [],
    configBaseHash: spec?.editable?.configBaseHash ?? "",
  }));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  // Reset draft when the spec changes (e.g. after a successful apply).
  useEffect(() => {
    setDraft({ config: {}, text: [], configBaseHash: spec?.editable?.configBaseHash ?? "" });
    setPreview(null);
    setError(null);
    setShowDiff(false);
  }, [spec?.generatedAt]);

  const configDirtyCount = Object.keys(draft.config).length;
  const textDirtyCount = draft.text.length;
  const dirtyCount = configDirtyCount + textDirtyCount;

  function setField(configPath, value) {
    setDraft((d) => {
      const sourceValue = spec.editable.fields.find((f) => f.configPath === configPath)?.sourceValue;
      const next = { ...d.config };
      if (deepEqual(value, sourceValue)) {
        delete next[configPath];
      } else {
        next[configPath] = value;
      }
      return { ...d, config: next };
    });
  }

  function getField(configPath) {
    return draft.config[configPath] !== undefined
      ? draft.config[configPath]
      : spec.editable.fields.find((f) => f.configPath === configPath)?.effectiveValue;
  }

  function setText(path, content, baseHash) {
    setDraft((d) => {
      const existing = d.text.find((e) => e.path === path);
      let next = d.text;
      // If the new content equals the original hash baseline, drop the edit.
      const sameAsBaseline = existing && existing.baseHash === baseHash && existing.content === content;
      if (sameAsBaseline) {
        next = d.text.filter((e) => e.path !== path);
      } else if (existing) {
        next = d.text.map((e) => (e.path === path ? { path, content, baseHash } : e));
      } else {
        next = [...d.text, { path, content, baseHash }];
      }
      return { ...d, text: next };
    });
  }

  function getText(path) {
    return draft.text.find((e) => e.path === path);
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: draft.config, text: draft.text, configBaseHash: draft.configBaseHash }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
        setPreview(null);
        return;
      }
      setPreview(body);
      setShowDiff(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply(currentSpec) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: draft.config, text: draft.text, configBaseHash: draft.configBaseHash }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
        return { ok: false, status: res.status, body };
      }
      // Replace the spec on success; the useEffect will reset the draft.
      currentSpec(body.spec);
      setPreview(null);
      setShowDiff(false);
      return { ok: true };
    } catch (e) {
      setError(String(e));
      return { ok: false, error: String(e) };
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setDraft({ config: {}, text: [], configBaseHash: spec?.editable?.configBaseHash ?? "" });
    setPreview(null);
    setShowDiff(false);
    setError(null);
  }

  return {
    draft,
    preview,
    busy,
    error,
    showDiff,
    dirtyCount,
    configDirtyCount,
    textDirtyCount,
    setField,
    getField,
    setText,
    getText,
    setShowDiff,
    runPreview,
    apply,
    discard,
  };
}

// ---------------- widgets ----------------

function Dropdown({ field, value, onChange, disabled }) {
  return React.createElement(
    "select",
    { className: "w-input", value: value ?? "", onChange: (e) => onChange(e.target.value), disabled },
    (field.enumValues ?? []).map((opt) => React.createElement("option", { key: opt, value: opt }, opt))
  );
}

function NumberInput({ field, value, onChange, disabled }) {
  return React.createElement("input", {
    className: "w-input",
    type: "number",
    min: field.min,
    max: field.max,
    step: "any",
    value: value ?? "",
    onChange: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)),
    disabled,
  });
}

function TextInput({ field, value, onChange, disabled }) {
  const hint = field.hint;
  return React.createElement("div", { className: "w-text-wrap" },
    hint ? React.createElement("span", { className: `w-hint w-hint-${hint}` }, hint) : null,
    React.createElement("input", {
      className: "w-input",
      type: hint === "url" ? "url" : "text",
      value: value ?? "",
      placeholder: field.hint === "env-name" ? "e.g. ANTHROPIC_API_KEY" : field.hint === "path" ? "prompts/developer-agent.system.md" : "",
      onChange: (e) => onChange(e.target.value),
      disabled,
    })
  );
}

function Switch({ field, value, onChange, disabled }) {
  return React.createElement(
    "label",
    { className: "w-switch" },
    React.createElement("input", {
      type: "checkbox",
      checked: !!value,
      onChange: (e) => onChange(e.target.checked),
      disabled,
    }),
    React.createElement("span", { className: "w-switch-slider" })
  );
}

function Taglist({ field, value, onChange, disabled }) {
  const [draft, setDraft] = useState("");
  const items = Array.isArray(value) ? value : [];
  function commit() {
    const next = draft.trim();
    if (next) onChange([...items, next]);
    setDraft("");
  }
  function removeAt(idx) {
    onChange(items.filter((_, i) => i !== idx));
  }
  return React.createElement(
    "div",
    { className: "w-taglist" },
    React.createElement(
      "div",
      { className: "w-chips" },
      items.length === 0
        ? React.createElement("span", { className: "w-empty" }, "(empty)")
        : items.map((item, idx) =>
            React.createElement(
              "span",
              { key: `${idx}-${item}`, className: "w-chip" },
              item,
              React.createElement(
                "button",
                { type: "button", onClick: () => removeAt(idx), disabled, "aria-label": `Remove ${item}` },
                "x"
              )
            )
          )
    ),
    React.createElement("input", {
      className: "w-input",
      type: "text",
      value: draft,
      placeholder: "Add entry, Enter to add",
      onChange: (e) => setDraft(e.target.value),
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          commit();
        } else if (e.key === "Backspace" && draft === "" && items.length > 0) {
          removeAt(items.length - 1);
        }
      },
      disabled,
    })
  );
}

function Textarea({ value, onChange, rows = 12, disabled }) {
  return React.createElement("textarea", {
    className: "w-textarea",
    rows,
    value: value ?? "",
    onChange: (e) => onChange(e.target.value),
    disabled,
  });
}

function Widget({ field, value, onChange, disabled, overridden, effectiveValue }) {
  const wrap = (control) =>
    React.createElement(
      "div",
      { className: `widget ${field.widget}${overridden ? " widget-overridden" : ""}` },
      React.createElement(
        "div",
        { className: "widget-head" },
        React.createElement("span", { className: "widget-label" }, field.label),
        React.createElement("span", { className: "widget-path" }, field.configPath),
        overridden
          ? React.createElement("span", { className: "widget-badge", title: `Effective value differs from source: ${JSON.stringify(effectiveValue)}` }, "env override")
          : null
      ),
      React.createElement("div", { className: "widget-body" }, control)
    );
  switch (field.widget) {
    case "dropdown":
      return wrap(React.createElement(Dropdown, { field, value, onChange, disabled }));
    case "number":
      return wrap(React.createElement(NumberInput, { field, value, onChange, disabled }));
    case "text":
      return wrap(React.createElement(TextInput, { field, value, onChange, disabled }));
    case "switch":
      return wrap(React.createElement(Switch, { field, value, onChange, disabled }));
    case "taglist":
      return wrap(React.createElement(Taglist, { field, value, onChange, disabled }));
    case "textarea":
      return wrap(React.createElement(Textarea, { value, onChange, rows: 12, disabled }));
    default:
      return wrap(React.createElement("pre", null, JSON.stringify(value)));
  }
}

// ---------------- text file editor ----------------

function PromptEditor({ path, label, draft, onSave, onRemove }) {
  const file = useTextFile(path);
  const [content, setContent] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (file.content !== null && !dirty) setContent(file.content);
  }, [file.content, dirty]);

  // If a draft already exists for this path (from a prior unsaved edit), use it.
  useEffect(() => {
    if (draft && content === null) setContent(draft.content);
  }, [draft, content]);

  if (!path) return null;
  const isDrafted = !!draft;
  return React.createElement(
    "div",
    { className: `prompt-editor${isDrafted ? " prompt-editor-dirty" : ""}` },
    React.createElement(
      "div",
      { className: "prompt-editor-head" },
      React.createElement("span", { className: "prompt-editor-label" }, label),
      React.createElement("span", { className: "prompt-editor-path" }, path),
      open
        ? null
        : React.createElement(
            "button",
            { type: "button", className: "btn", onClick: () => setOpen(true) },
            file.loading ? "Loading..." : "Edit"
          ),
      isDrafted && !open
        ? React.createElement("span", { className: "prompt-editor-badge" }, "modified")
        : null
    ),
    open
      ? React.createElement(
          React.Fragment,
          null,
          file.loading
            ? React.createElement("p", { className: "muted" }, "Loading file...")
            : file.error
              ? React.createElement("p", { className: "error" }, `Cannot read: ${file.error}`)
              : React.createElement(Textarea, {
                  value: content ?? "",
                  onChange: (v) => {
                    setContent(v);
                    setDirty(true);
                  },
                  rows: 16,
                }),
          React.createElement(
            "div",
            { className: "prompt-editor-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn",
                onClick: () => {
                  setOpen(false);
                  setContent(file.content);
                  setDirty(false);
                  if (isDrafted) onRemove();
                },
                disabled: file.loading,
              },
              "Cancel"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-primary",
                onClick: () => {
                  onSave(content, file.hash);
                  setOpen(false);
                  setDirty(false);
                },
                disabled: file.loading || file.error,
              },
              isDrafted ? "Update edit" : "Stage edit"
            )
          )
        )
      : null
  );
}

// ---------------- change bar + diff modal ----------------

function ChangeBar({ dirtyCount, onPreview, onDiscard, busy, error }) {
  if (dirtyCount === 0 && !error) return null;
  return React.createElement(
    "div",
    { className: "change-bar" },
    React.createElement("span", { className: "change-bar-count" }, `${dirtyCount} pending change${dirtyCount === 1 ? "" : "s"}`),
    error ? React.createElement("span", { className: "change-bar-error" }, error) : null,
    React.createElement(
      "div",
      { className: "change-bar-actions" },
      React.createElement(
        "button",
        { type: "button", className: "btn", onClick: onDiscard, disabled: busy || dirtyCount === 0 },
        "Discard"
      ),
      React.createElement(
        "button",
        { type: "button", className: "btn btn-primary", onClick: onPreview, disabled: busy || dirtyCount === 0 },
        busy ? "Working..." : "View diff"
      )
    )
  );
}

function fileDiff(a, b) {
  const aLines = String(a).split("\n");
  const bLines = String(b).split("\n");
  const max = Math.max(aLines.length, bLines.length);
  const rows = [];
  for (let i = 0; i < max; i += 1) {
    const left = aLines[i] ?? "";
    const right = bLines[i] ?? "";
    let cls = "diff-same";
    if (left !== right) {
      cls = left && right ? "diff-mod" : left ? "diff-del" : "diff-add";
    }
    rows.push({ left, right, cls });
  }
  return rows;
}

function DiffModal({ preview, onClose, onApply, busy, error }) {
  if (!preview) return null;
  return React.createElement(
    "div",
    { className: "modal-backdrop", onClick: onClose },
    React.createElement(
      "div",
      { className: "modal", onClick: (e) => e.stopPropagation() },
      React.createElement(
        "div",
        { className: "modal-head" },
        React.createElement("h2", null, "Pending changes"),
        React.createElement("button", { type: "button", className: "btn", onClick: onClose }, "Close")
      ),
      preview.validation && !preview.validation.ok
        ? React.createElement(
            "div",
            { className: "modal-validation" },
            React.createElement("strong", null, "Validation failed:"),
            React.createElement(
              "ul",
              null,
              preview.validation.errors.map((e, i) =>
                React.createElement("li", { key: i }, `${e.path || "(root)"}: ${e.message}`)
              )
            )
          )
        : null,
      error ? React.createElement("div", { className: "modal-error" }, error) : null,
      React.createElement(
        "div",
        { className: "modal-files" },
        (preview.files || []).map((file) => {
          const rows = fileDiff(file.before, file.after);
          return React.createElement(
            "div",
            { key: file.path, className: "modal-file" },
            React.createElement(
              "div",
              { className: "modal-file-head" },
              React.createElement("span", { className: `kind-badge kind-${file.kind}` }, file.kind),
              React.createElement("span", { className: "modal-file-path" }, file.path)
            ),
            React.createElement(
              "pre",
              { className: "modal-file-body" },
              rows.map((r, idx) =>
                React.createElement(
                  "div",
                  { key: idx, className: `diff-row ${r.cls}` },
                  r.left ? ` ${r.left}` : " ",
                  r.left !== r.right ? React.createElement("br", null) : null,
                  r.right ? ` ${r.right}` : ""
                )
              )
            )
          );
        })
      ),
      React.createElement(
        "div",
        { className: "modal-foot" },
        React.createElement("button", { type: "button", className: "btn", onClick: onClose, disabled: busy }, "Cancel"),
        React.createElement(
          "button",
          {
            type: "button",
            className: "btn btn-primary",
            onClick: onApply,
            disabled: busy || (preview.validation && !preview.validation.ok),
          },
          busy ? "Applying..." : "Apply"
        )
      )
    )
  );
}

// ---------------- right panel ----------------

function RightPanel({ spec, flow, focusedSection }) {
  if (!spec.editable) {
    return React.createElement(
      "aside",
      { className: "detail" },
      React.createElement("h2", null, "Inspector"),
      React.createElement("p", null, "This workspace has no editable spec.")
    );
  }
  const grouped = new Map();
  for (const field of spec.editable.fields) {
    const list = grouped.get(field.section) ?? [];
    list.push(field);
    grouped.set(field.section, list);
  }
  const sectionNames = Array.from(grouped.keys());

  const promptFiles = collectPromptFiles(spec);

  return React.createElement(
    "aside",
    { className: "detail editing-panel" },
    React.createElement(
      "div",
      { className: "editing-panel-head" },
      React.createElement("h2", null, "Editing"),
      React.createElement("span", { className: "editing-panel-file" }, spec.editable.configFile)
    ),
    React.createElement(
      "div",
      { className: "editing-panel-sections" },
      sectionNames.map((section) => {
        const fields = grouped.get(section);
        if (focusedSection && focusedSection !== section) return null;
        return React.createElement(
          "section",
          { key: section, className: "editing-section", id: `section-${section}` },
          React.createElement("h3", null, sectionLabel(section)),
          fields.map((field) => {
            const overridden = field.overridden;
            const effective = field.effectiveValue;
            const value = flow.getField(field.configPath);
            return React.createElement(Widget, {
              key: field.configPath,
              field,
              value,
              effectiveValue: effective,
              overridden,
              onChange: (v) => flow.setField(field.configPath, v),
              disabled: flow.busy,
            });
          })
        );
      })
    ),
    promptFiles.length > 0
      ? React.createElement(
          "section",
          { className: "editing-section prompts" },
          React.createElement("h3", null, "Text files"),
          promptFiles.map((pf) =>
            React.createElement(PromptEditor, {
              key: pf.path,
              path: pf.path,
              label: pf.label,
              draft: flow.getText(pf.path),
              onSave: (content, baseHash) => flow.setText(pf.path, content, baseHash),
              onRemove: () => flow.setText(pf.path, "", ""),
            })
          )
        )
      : null
  );
}

function sectionLabel(section) {
  const map = {
    meta: "Agent meta",
    model: "Model",
    permissions: "Permissions",
    middleware: "Middleware",
    lifecycle: "Lifecycle",
    memory: "Memory",
    skills: "Skills",
  };
  return map[section] ?? section;
}

function collectPromptFiles(spec) {
  const items = [];
  if (spec.systemPrompt?.path) {
    items.push({ path: spec.systemPrompt.path, label: "System prompt" });
  }
  for (const sa of spec.subagents ?? []) {
    if (sa.source && /\.(md|txt)$/i.test(sa.source)) {
      items.push({ path: sa.source, label: `Subagent: ${sa.name}` });
    }
  }
  for (const sk of spec.skills?.files ?? []) {
    if (sk.path && /SKILL\.md$/i.test(sk.path)) {
      items.push({ path: sk.path, label: `Skill: ${sk.name}` });
    }
  }
  return items;
}

// ---------------- section graph (config-derived pipeline) ----------------

function PipelineView({ spec, setSelected, focusedSection }) {
  const groups = useMemo(() => {
    const editableBySection = new Map();
    for (const f of spec.editable?.fields ?? []) {
      const list = editableBySection.get(f.section) ?? [];
      list.push(f);
      editableBySection.set(f.section, list);
    }
    return [
      { id: "agent", label: "Agent", editable: false, detail: spec.meta },
      {
        id: "model",
        label: "Model",
        editable: true,
        section: "model",
        detail: spec.meta.model,
      },
      {
        id: "prompt",
        label: "System prompt",
        editable: !!spec.systemPrompt?.path,
        path: spec.systemPrompt?.path,
        detail: spec.systemPrompt,
      },
      {
        id: "tools",
        label: `Tools (${spec.tools.length})`,
        editable: false,
        locked: true,
        detail: { kind: "tools", items: spec.tools },
      },
      {
        id: "subagents",
        label: `Subagents (${spec.subagents.length})`,
        editable: false,
        locked: true,
        detail: { kind: "subagents", items: spec.subagents },
      },
      {
        id: "skills",
        label: `Skills (${spec.skills.files.length})`,
        editable: true,
        section: "skills",
        detail: spec.skills,
      },
      {
        id: "middleware",
        label: `Middleware (${spec.middleware.length})`,
        editable: true,
        section: "middleware",
        detail: spec.middleware,
      },
      {
        id: "permissions",
        label: "Permissions",
        editable: true,
        section: "permissions",
        detail: spec.permissions,
      },
      {
        id: "memory",
        label: "Memory",
        editable: true,
        section: "memory",
        detail: spec.memory,
      },
      {
        id: "lifecycle",
        label: "Lifecycle (compaction / eviction)",
        editable: true,
        section: "lifecycle",
        detail: { compactionEnabled: spec.editable?.fields.find((f) => f.configPath === "compaction.enabled")?.effectiveValue },
      },
    ];
  }, [spec]);

  return React.createElement(
    "div",
    { className: "section-graph" },
    groups.map((g) => {
      const cls = [
        "section-card",
        g.editable ? "section-card-editable" : "",
        g.locked ? "section-card-locked" : "",
        focusedSection && g.section === focusedSection ? "section-card-focused" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return React.createElement(
        "button",
        {
          key: g.id,
          type: "button",
          className: cls,
          onClick: () => setSelected(g.section || g.id),
        },
        React.createElement(
          "div",
          { className: "section-card-head" },
          React.createElement("strong", null, g.label),
          g.locked ? React.createElement("span", { className: "section-card-lock" }, "locked") : null,
          g.editable && !g.locked ? React.createElement("span", { className: "section-card-pen" }, "editable") : null
        ),
        React.createElement(
          "div",
          { className: "section-card-sub" },
          g.section ? sectionLabel(g.section) : g.locked ? "code-defined / file-discovered" : g.path ?? ""
        )
      );
    })
  );
}

// ---------------- header + tabs ----------------

function Header({ spec, dirtyCount, onPreview, onDiscard }) {
  return React.createElement(
    "header",
    { className: "topbar" },
    React.createElement(
      "div",
      null,
      React.createElement("h1", null, spec.meta.agentName),
      React.createElement("p", null, spec.meta.agentDescription || "DeepAgents orchestration snapshot")
    ),
    React.createElement(
      "div",
      { className: "status-grid" },
      badge("Model", spec.meta.model.modelString),
      badge("Mode", spec.mode),
      badge("Permissions", spec.meta.permissionsMode),
      badge("Editable", spec.editable ? `${spec.editable.fields.length} fields` : "no"),
      dirtyCount > 0 ? badge("Pending", String(dirtyCount), "warn") : null
    ),
    dirtyCount > 0
      ? React.createElement(
          "div",
          { className: "topbar-actions" },
          React.createElement("button", { type: "button", className: "btn", onClick: onDiscard }, "Discard all"),
          React.createElement("button", { type: "button", className: "btn btn-primary", onClick: onPreview }, "View diff")
        )
      : null
  );
}

function Tabs({ tab, setTab, hasGraph }) {
  const items = hasGraph ? ["graph", "pipeline", "resources", "json"] : ["pipeline", "resources", "json"];
  return React.createElement(
    "nav",
    { className: "tabs" },
    items.map((item) =>
      React.createElement(
        "button",
        { key: item, className: tab === item ? "active" : "", onClick: () => setTab(item) },
        item
      )
    )
  );
}

function GraphView({ spec, graph, setSelected }) {
  if (!spec.graph) {
    return React.createElement(
      "div",
      { className: "empty-state" },
      React.createElement("h2", null, "Dry-run snapshot"),
      React.createElement("p", null, "Run with --full to include the compiled LangGraph topology."),
      React.createElement(
        "dl",
        null,
        stat("Tools", spec.tools.length),
        stat("Middleware", spec.middleware.length),
        stat("Skills", spec.skills.files.length),
        stat("Subagents", spec.subagents.length)
      )
    );
  }
  return React.createElement(
    "div",
    { className: "graph-canvas" },
    React.createElement(
      ReactFlow,
      {
        nodes: graph.nodes,
        edges: graph.edges,
        fitView: true,
        onNodeClick: (_e, node) => setSelected(node.data.detail),
      },
      React.createElement(MiniMap, null),
      React.createElement(Controls, null),
      React.createElement(Background, { gap: 18 })
    )
  );
}

function ResourcesView({ spec, setSelected }) {
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
      React.createElement(
        "button",
        {
          key: `${row.group}:${row.label}`,
          onClick: () => setSelected({ kind: row.group, ...row.detail }),
        },
        React.createElement("span", null, row.group),
        React.createElement("strong", null, row.label)
      )
    )
  );
}

// ---------------- root ----------------

function toFlowGraph(graph) {
  if (!graph) return { nodes: [], edges: [] };
  const columns = Math.ceil(Math.sqrt(graph.nodes.length || 1));
  const nodes = graph.nodes.map((node, index) => ({
    id: node.id,
    type: "default",
    position: { x: (index % columns) * 220, y: Math.floor(index / columns) * 130 },
    data: { label: node.name, detail: node },
    className: `node-${node.type}`,
  }));
  const edges = graph.edges.map((edge, index) => ({
    id: `${edge.source}-${edge.target}-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.data,
    animated: edge.conditional,
  }));
  return { nodes, edges };
}

function badge(label, value, mod) {
  return React.createElement(
    "div",
    { className: `badge${mod ? " badge-" + mod : ""}` },
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

function App() {
  const [currentSpec, setCurrentSpec] = useState(initialSpec);
  const spec = currentSpec;
  const [tab, setTab] = useState(spec.graph ? "graph" : "pipeline");
  const [focusedSection, setFocusedSection] = useState(null);
  const flow = useApplyFlow(spec);
  const graph = useMemo(() => toFlowGraph(spec.graph), [spec.graph]);

  const setSelectedSection = (id) => {
    setFocusedSection(id);
    if (id) {
      const el = document.getElementById(`section-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return React.createElement(
    "main",
    { className: "shell" },
    React.createElement(Header, {
      spec,
      dirtyCount: flow.dirtyCount,
      onPreview: flow.runPreview,
      onDiscard: flow.discard,
    }),
    React.createElement(ChangeBar, {
      dirtyCount: flow.dirtyCount,
      onPreview: flow.runPreview,
      onDiscard: flow.discard,
      busy: flow.busy,
      error: flow.error,
    }),
    React.createElement(
      "section",
      { className: "workspace" },
      React.createElement(
        "div",
        { className: "main-pane" },
        React.createElement(Tabs, { tab, setTab, hasGraph: !!spec.graph }),
        tab === "graph" && React.createElement(GraphView, { spec, graph, setSelected: setSelectedSection }),
        tab === "pipeline" && React.createElement(PipelineView, { spec, setSelected: setSelectedSection, focusedSection }),
        tab === "resources" && React.createElement(ResourcesView, { spec, setSelected: setSelectedSection }),
        tab === "json" && React.createElement("pre", { className: "json-view" }, JSON.stringify(spec, null, 2))
      ),
      React.createElement(RightPanel, { spec, flow, focusedSection })
    ),
    flow.showDiff
      ? React.createElement(DiffModal, {
          preview: flow.preview,
          onClose: () => flow.setShowDiff(false),
          onApply: () => flow.apply(setCurrentSpec),
          busy: flow.busy,
          error: flow.error,
        })
      : null
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
