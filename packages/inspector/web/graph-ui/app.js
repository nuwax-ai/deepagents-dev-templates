import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactFlow, { Background, Controls, MiniMap } from "reactflow";

const spec = window.__INSPECTOR_SPEC__ || (await fetch("/api/spec").then((response) => response.json()));

function App() {
  const [tab, setTab] = useState(spec.graph ? "graph" : "pipeline");
  const [selected, setSelected] = useState(null);
  const graph = useMemo(() => toFlowGraph(spec.graph), []);

  return React.createElement(
    "main",
    { className: "shell" },
    React.createElement(Header, { spec }),
    React.createElement(
      "section",
      { className: "workspace" },
      React.createElement(
        "div",
        { className: "main-pane" },
        React.createElement(Tabs, { tab, setTab }),
        tab === "graph" && React.createElement(GraphView, { spec, graph, setSelected }),
        tab === "pipeline" && React.createElement(PipelineView, { middleware: spec.middleware, setSelected }),
        tab === "resources" && React.createElement(ResourcesView, { spec, setSelected }),
        tab === "json" && React.createElement("pre", { className: "json-view" }, JSON.stringify(spec, null, 2))
      ),
      React.createElement(DetailPanel, { selected })
    )
  );
}

function Header({ spec }) {
  return React.createElement(
    "header",
    { className: "topbar" },
    React.createElement("div", null, React.createElement("h1", null, spec.meta.agentName), React.createElement("p", null, spec.meta.agentDescription || "DeepAgents orchestration snapshot")),
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
    ["graph", "pipeline", "resources", "json"].map((item) =>
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
      React.createElement("dl", null, stat("Tools", spec.tools.length), stat("Middleware", spec.middleware.length), stat("Skills", spec.skills.files.length), stat("Subagents", spec.subagents.length))
    );
  }
  return React.createElement(
    "div",
    { className: "graph-canvas" },
    React.createElement(ReactFlow, {
      nodes: graph.nodes,
      edges: graph.edges,
      fitView: true,
      onNodeClick: (_event, node) => setSelected(node.data.detail),
    }, React.createElement(MiniMap, null), React.createElement(Controls, null), React.createElement(Background, { gap: 18 }))
  );
}

function PipelineView({ middleware, setSelected }) {
  return React.createElement(
    "ol",
    { className: "pipeline" },
    middleware.map((item) =>
      React.createElement(
        "li",
        { key: item.name, onClick: () => setSelected(item), className: item.enabled ? "enabled" : "disabled" },
        React.createElement("span", { className: "step" }, String(item.order + 1).padStart(2, "0")),
        React.createElement("strong", null, item.name),
        React.createElement("span", null, item.factory),
        React.createElement("em", null, item.enabled ? "enabled" : "disabled")
      )
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
        { key: `${row.group}:${row.label}`, onClick: () => setSelected(row.detail) },
        React.createElement("span", null, row.group),
        React.createElement("strong", null, row.label)
      )
    )
  );
}

function DetailPanel({ selected }) {
  return React.createElement(
    "aside",
    { className: "detail" },
    React.createElement("h2", null, "Detail"),
    selected
      ? React.createElement("pre", null, JSON.stringify(selected, null, 2))
      : React.createElement("p", null, "Select a graph node, pipeline step, or resource.")
  );
}

function toFlowGraph(graph) {
  if (!graph) {
    return { nodes: [], edges: [] };
  }
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

function badge(label, value) {
  return React.createElement("div", { className: "badge" }, React.createElement("span", null, label), React.createElement("strong", null, value));
}

function stat(label, value) {
  return React.createElement(React.Fragment, { key: label }, React.createElement("dt", null, label), React.createElement("dd", null, value));
}

createRoot(document.getElementById("root")).render(React.createElement(App));
