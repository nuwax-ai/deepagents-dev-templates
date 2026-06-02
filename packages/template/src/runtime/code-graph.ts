import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

export type CodeGraphNodeKind =
  | "entrypoint"
  | "runtime"
  | "tool"
  | "skill"
  | "prompt"
  | "config"
  | "distribution"
  | "script"
  | "test";

export interface CodeGraphNode {
  id: string;
  label: string;
  kind: CodeGraphNodeKind;
  path: string;
  editable: "protected" | "ai-user" | "user-platform" | "generated";
}

export interface CodeGraphEdge {
  from: string;
  to: string;
  kind: "calls" | "loads" | "configures" | "packages" | "tests";
}

export interface CodeGraph {
  schema: "nuwaclaw.agent-code-graph.v1";
  generatedAt: string;
  root: string;
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
}

function rel(root: string, path: string): string {
  return relative(root, resolve(root, path)).replaceAll("\\", "/");
}

function addIfExists(
  nodes: CodeGraphNode[],
  root: string,
  node: Omit<CodeGraphNode, "path"> & { path: string }
): void {
  if (existsSync(resolve(root, node.path))) {
    nodes.push({ ...node, path: rel(root, node.path) });
  }
}

function listSkillNodes(root: string): CodeGraphNode[] {
  const nodes: CodeGraphNode[] = [];
  for (const base of ["skills/builtin", "skills/platform"]) {
    const baseAbs = resolve(root, base);
    if (!existsSync(baseAbs)) continue;
    for (const name of readdirSync(baseAbs)) {
      const skillPath = `${base}/${name}/SKILL.md`;
      if (!existsSync(resolve(root, skillPath))) continue;
      nodes.push({
        id: `skill:${name}`,
        label: name,
        kind: "skill",
        path: rel(root, skillPath),
        editable: "ai-user",
      });
    }
  }
  return nodes;
}

export function generateCodeGraph(root = process.cwd()): CodeGraph {
  const nodes: CodeGraphNode[] = [];

  addIfExists(nodes, root, {
    id: "entry:index",
    label: "ACP/CLI entrypoint",
    kind: "entrypoint",
    path: "src/index.ts",
    editable: "protected",
  });

  for (const [id, label, path] of [
    ["runtime:acp-server", "ACP server", "src/runtime/acp-server.ts"],
    ["runtime:agent-factory", "Agent factory", "src/runtime/agent-factory.ts"],
    ["runtime:config-loader", "Config loader", "src/runtime/config-loader.ts"],
    ["runtime:helpers", "Runtime helpers", "src/runtime/helpers.ts"],
    ["runtime:platform-client", "Platform client", "src/runtime/platform-client.ts"],
    ["runtime:mcp-manager", "MCP manager", "src/runtime/mcp-manager.ts"],
    ["runtime:variables", "Variable manager", "src/runtime/variable-manager.ts"],
    ["runtime:code-graph", "Code graph generator", "src/runtime/code-graph.ts"],
  ] as const) {
    addIfExists(nodes, root, {
      id,
      label,
      kind: "runtime",
      path,
      editable: "protected",
    });
  }

  for (const [id, label, path] of [
    ["tool:http-request", "HTTP request tool", "src/app/tools/http-request.tool.ts"],
    ["tool:json-utils", "JSON utils tool", "src/app/tools/json-utils.tool.ts"],
    ["tool:platform-api", "Platform API tool", "src/app/tools/platform-api.tool.ts"],
    ["tool:agent-variable", "Agent variable tool", "src/app/tools/agent-variable.tool.ts"],
    ["tool:mcp-bridge", "MCP bridge tool", "src/app/tools/mcp-bridge.tool.ts"],
  ] as const) {
    addIfExists(nodes, root, {
      id,
      label,
      kind: "tool",
      path,
      editable: "ai-user",
    });
  }

  for (const [id, label, path] of [
    ["prompt:developer", "Developer agent system prompt", "prompts/developer-agent.system.md"],
    ["prompt:target-base", "Target agent base prompt", "prompts/target-agent.base.md"],
    ["config:app", "Application config", "config/app-agent.config.json"],
    ["config:mcp", "Default MCP config", "config/mcp.default.json"],
    ["config:platform", "Platform endpoint config", "config/platform.json"],
    ["manifest:template", "Template manifest", "template.manifest.json"],
    ["manifest:package", "Agent package manifest", "agent-package.json"],
    ["script:package", "Package script", "scripts/package.sh"],
  ] as const) {
    addIfExists(nodes, root, {
      id,
      label,
      kind: id.startsWith("prompt:")
        ? "prompt"
        : id.startsWith("config:")
          ? "config"
          : id.startsWith("script:")
            ? "script"
            : "distribution",
      path,
      editable: id.startsWith("config:") ? "user-platform" : "ai-user",
    });
  }

  nodes.push(...listSkillNodes(root));

  const skillEdges = nodes
    .filter((node) => node.kind === "skill")
    .map((node) => ({
      from: "runtime:helpers",
      to: node.id,
      kind: "loads" as const,
    }));

  const edges: CodeGraphEdge[] = [
    { from: "entry:index", to: "runtime:acp-server", kind: "calls" },
    { from: "entry:index", to: "runtime:agent-factory", kind: "calls" },
    { from: "runtime:acp-server", to: "runtime:config-loader", kind: "loads" },
    { from: "runtime:acp-server", to: "runtime:helpers", kind: "calls" },
    { from: "runtime:agent-factory", to: "runtime:helpers", kind: "calls" },
    { from: "runtime:helpers", to: "runtime:platform-client", kind: "configures" },
    { from: "runtime:helpers", to: "runtime:mcp-manager", kind: "configures" },
    { from: "runtime:helpers", to: "runtime:variables", kind: "configures" },
    { from: "runtime:helpers", to: "tool:http-request", kind: "loads" },
    { from: "runtime:helpers", to: "tool:json-utils", kind: "loads" },
    { from: "runtime:helpers", to: "tool:platform-api", kind: "loads" },
    { from: "runtime:helpers", to: "tool:agent-variable", kind: "loads" },
    { from: "runtime:helpers", to: "tool:mcp-bridge", kind: "loads" },
    { from: "runtime:config-loader", to: "config:app", kind: "loads" },
    { from: "runtime:mcp-manager", to: "config:mcp", kind: "loads" },
    { from: "runtime:platform-client", to: "config:platform", kind: "configures" },
    { from: "runtime:helpers", to: "prompt:developer", kind: "loads" },
    { from: "script:package", to: "manifest:package", kind: "packages" },
    { from: "script:package", to: "manifest:template", kind: "packages" },
    ...skillEdges,
  ];

  return {
    schema: "nuwaclaw.agent-code-graph.v1",
    generatedAt: new Date().toISOString(),
    root,
    nodes,
    edges: edges.filter((edge) =>
      nodes.some((node) => node.id === edge.from) &&
      nodes.some((node) => node.id === edge.to)
    ),
  };
}

export function writeCodeGraph(outputPath: string, root = process.cwd()): CodeGraph {
  const graph = generateCodeGraph(root);
  writeFileSync(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
  return graph;
}
