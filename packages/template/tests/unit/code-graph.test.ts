import { describe, expect, it } from "vitest";
import { generateCodeGraph } from "../../src/runtime/code-graph.js";

describe("code graph", () => {
  it("generates a nuwaclaw-readable graph for the template", () => {
    const graph = generateCodeGraph(process.cwd());
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`));

    expect(graph.schema).toBe("nuwaclaw.agent-code-graph.v1");
    expect(nodeIds).toContain("entry:index");
    expect(nodeIds).toContain("runtime:acp-server");
    expect(nodeIds).toContain("runtime:code-graph");
    expect(nodeIds).toContain("tool:platform-api");
    expect(nodeIds).toContain("tool:mcp-bridge");
    expect(nodeIds).toContain("config:mcp");
    expect(nodeIds).toContain("manifest:package");
    expect(nodeIds).toContain("skill:platform-tool-selection");

    expect(edgeIds).toContain("entry:index->runtime:acp-server:calls");
    expect(edgeIds).toContain("runtime:helpers->tool:platform-api:loads");
    expect(edgeIds).toContain("runtime:mcp-manager->config:mcp:loads");
    expect(edgeIds).toContain("script:package->manifest:package:packages");
  });
});
