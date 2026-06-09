import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { parse as parseYaml } from "yaml";

export type CodeGraphNodeKind =
  | "entrypoint"
  | "runtime"
  | "tool"
  | "middleware"
  | "skill"
  | "subagent"
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

function listMiddlewareNodes(root: string): CodeGraphNode[] {
  const dir = resolve(root, "src/runtime/middleware");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => {
      // humanize: "fs-path-resolver.ts" → "Fs path resolver"
      const label = name
        .replace(/\.ts$/, "")
        .split("-")
        .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
        .join(" ");
      return {
        id: `middleware:${name.replace(/\.ts$/, "")}`,
        label,
        kind: "middleware" as const,
        path: rel(root, `src/runtime/middleware/${name}`),
        editable: "protected" as const,
      };
    });
}

/**
 * Best-effort read of the app config JSON. Returns {} on any failure — config
 * problems must never break graph generation (the `graph` subcommand can run
 * when config is absent or mid-edit).
 */
function readAppConfig(root: string): Record<string, unknown> {
  try {
    const configPath = resolve(root, "config/app-agent.config.json");
    if (existsSync(configPath)) {
      return JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    }
  } catch {
    // non-fatal
  }
  return {};
}

/**
 * Skill scan roots, read from config `skills.directories` so the graph stays in
 * sync with what the agent actually loads. Falls back to the built-in layout
 * when config is missing or empty.
 */
function readSkillDirectories(root: string): string[] {
  const fallback = ["skills/builtin", "skills/platform"];
  const skills = readAppConfig(root).skills as Record<string, unknown> | undefined;
  if (skills && Array.isArray(skills.directories) && skills.directories.length > 0) {
    return skills.directories as string[];
  }
  return fallback;
}

function listSkillNodes(root: string): CodeGraphNode[] {
  const nodes: CodeGraphNode[] = [];
  const seen = new Set<string>();
  for (const base of readSkillDirectories(root)) {
    const baseAbs = resolve(root, base);
    if (!existsSync(baseAbs)) continue;
    for (const name of readdirSync(baseAbs)) {
      const skillPath = resolve(baseAbs, name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      if (seen.has(name)) continue; // a skill name wins from the first dir it appears in
      seen.add(name);
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

/**
 * List subagent nodes from configured .agents/agents/ directories.
 * Reads agentsDirectories from the app config to find AGENT.md files.
 */
function listSubAgentNodes(root: string): CodeGraphNode[] {
  const nodes: CodeGraphNode[] = [];

  // Read agentsDirectories from the same app config the runtime uses.
  const config = readAppConfig(root);
  const agentsDirectories = Array.isArray(config.agentsDirectories)
    ? (config.agentsDirectories as string[])
    : [];

  for (const agentsDir of agentsDirectories) {
    const normalized = agentsDir.startsWith("./") || agentsDir.startsWith("/") ? agentsDir : `./${agentsDir}`;
    const agentsPath = resolve(root, normalized, "agents");
    if (!existsSync(agentsPath)) continue;

    let entries: string[];
    try {
      entries = readdirSync(agentsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const agentMdPath = join(agentsPath, entry, "AGENT.md");
      if (!existsSync(agentMdPath)) continue;

      // Try to extract name from frontmatter
      let label = entry;
      try {
        const content = readFileSync(agentMdPath, "utf-8");
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
          const parsed = parseYaml(fmMatch[1]) as Record<string, unknown> | null;
          if (parsed && typeof parsed === "object" && typeof parsed.name === "string") {
            label = parsed.name;
          }
        }
      } catch {
        // Use directory name as fallback
      }

      nodes.push({
        id: `subagent:${entry}`,
        label,
        kind: "subagent",
        path: rel(root, agentMdPath),
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
    ["runtime:acp-server", "ACP server", "src/surfaces/acp/server.ts"],
    ["runtime:agent-factory", "Agent factory", "src/runtime/agent-factory.ts"],
    ["runtime:config-loader", "Config loader", "src/runtime/config/config-loader.ts"],
    ["runtime:helpers", "Runtime helpers", "src/runtime/helpers.ts"],
    ["runtime:platform-client", "Platform client", "src/runtime/platform/platform-client.ts"],
    ["runtime:mcp-manager", "MCP manager", "src/runtime/platform/mcp-manager.ts"],
    ["runtime:variables", "Variable manager", "src/runtime/platform/variable-manager.ts"],
    ["runtime:harness-lifecycle", "Harness lifecycle", "src/runtime/storage/harness-lifecycle.ts"],
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
  nodes.push(...listSubAgentNodes(root));
  nodes.push(...listMiddlewareNodes(root));

  const skillEdges = nodes
    .filter((node) => node.kind === "skill")
    .map((node) => ({
      from: "runtime:helpers",
      to: node.id,
      kind: "loads" as const,
    }));

  const subagentEdges = nodes
    .filter((node) => node.kind === "subagent")
    .map((node) => ({
      from: "runtime:helpers",
      to: node.id,
      kind: "loads" as const,
    }));

  const middlewareEdges = nodes
    .filter((node) => node.kind === "middleware")
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
    { from: "runtime:helpers", to: "runtime:harness-lifecycle", kind: "configures" },
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
    ...subagentEdges,
    ...middlewareEdges,
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
