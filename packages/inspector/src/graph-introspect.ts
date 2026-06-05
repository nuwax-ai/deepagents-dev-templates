import type { GraphSpec } from "./types.js";

export interface DrawableGraphLike {
  nodes: Record<string, DrawableNodeLike>;
  edges: DrawableEdgeLike[];
  drawMermaid?: (params?: Record<string, unknown>) => string;
}

export interface DrawableNodeLike {
  id: string;
  name?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface DrawableEdgeLike {
  source: string;
  target: string;
  data?: string;
  conditional?: boolean;
}

export interface DeepAgentGraphLike {
  getGraphAsync?: (config?: { xray?: boolean | number }) => Promise<DrawableGraphLike>;
  drawMermaid?: (config?: { xray?: boolean | number }) => Promise<string> | string;
  graph?: {
    getGraphAsync?: (config?: { xray?: boolean | number }) => Promise<DrawableGraphLike>;
    builder?: unknown;
  };
  builder?: unknown;
}

export interface RuntimeGraphResult {
  graph: GraphSpec | null;
  warnings: string[];
}

export async function introspectRuntimeGraph(
  agent: unknown,
  options: { xray?: boolean | number } = {}
): Promise<RuntimeGraphResult> {
  const warnings: string[] = [];
  const graphLike = agent as DeepAgentGraphLike;
  const drawable = await loadDrawableGraph(graphLike, options, warnings);
  if (!drawable) {
    return { graph: null, warnings };
  }

  const mermaid = await drawMermaid(graphLike, drawable, options, warnings);
  const nodes = Object.entries(drawable.nodes ?? {}).map(([id, node]) => ({
    id,
    name: node.name || id,
    type: inferNodeType(id, node),
    metadata: node.metadata,
  }));
  const edges = (drawable.edges ?? []).map((edge) => ({
    source: edge.source,
    target: edge.target,
    data: edge.data,
    conditional: Boolean(edge.conditional),
  }));
  const conditionalBranches = extractConditionalBranches(graphLike, warnings);
  const conditionalEdgeCount = edges.filter((edge) => edge.conditional).length;

  return {
    graph: {
      nodes,
      edges,
      conditionalBranches,
      mermaid,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        conditionalEdgeCount,
        hasSubgraphs: nodes.some((node) => Boolean(node.metadata?.subgraphs) || node.id.includes(":")),
      },
    },
    warnings,
  };
}

async function loadDrawableGraph(
  agent: DeepAgentGraphLike,
  options: { xray?: boolean | number },
  warnings: string[]
): Promise<DrawableGraphLike | null> {
  try {
    if (typeof agent.getGraphAsync === "function") {
      return await agent.getGraphAsync(options);
    }
    if (typeof agent.graph?.getGraphAsync === "function") {
      return await agent.graph.getGraphAsync(options);
    }
  } catch (error) {
    warnings.push(`Failed to read LangGraph topology: ${errorMessage(error)}`);
    return null;
  }
  warnings.push("Agent does not expose getGraphAsync; graph inspection skipped");
  return null;
}

async function drawMermaid(
  agent: DeepAgentGraphLike,
  drawable: DrawableGraphLike,
  options: { xray?: boolean | number },
  warnings: string[]
): Promise<string> {
  try {
    if (typeof drawable.drawMermaid === "function") {
      return drawable.drawMermaid();
    }
    if (typeof agent.drawMermaid === "function") {
      return await agent.drawMermaid(options);
    }
  } catch (error) {
    warnings.push(`Failed to render Mermaid graph: ${errorMessage(error)}`);
  }
  return "";
}

function extractConditionalBranches(
  agent: DeepAgentGraphLike,
  warnings: string[]
): GraphSpec["conditionalBranches"] {
  const builder = agent.builder ?? agent.graph?.builder;
  const branches = (builder as { branches?: unknown } | undefined)?.branches;
  if (!branches || typeof branches !== "object") {
    return [];
  }

  try {
    return Object.entries(branches as Record<string, Record<string, { ends?: Record<string, string> }>>).map(
      ([source, branchGroup]) => {
        const paths = Object.values(branchGroup).flatMap((branch) =>
          Object.entries(branch.ends ?? {}).map(([condition, target]) => ({ condition, target }))
        );
        return { source, paths };
      }
    );
  } catch (error) {
    warnings.push(`Failed to read conditional branch metadata: ${errorMessage(error)}`);
    return [];
  }
}

function inferNodeType(id: string, node: DrawableNodeLike): string {
  const lower = `${id} ${node.name ?? ""}`.toLowerCase();
  if (lower.includes("tool")) {
    return "tool";
  }
  if (lower.includes("agent") || lower.includes("model")) {
    return "agent";
  }
  if (lower.includes("__start__") || lower.includes("__end__")) {
    return "boundary";
  }
  return "node";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
