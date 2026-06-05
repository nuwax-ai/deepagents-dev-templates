import { describe, expect, it } from "vitest";
import { introspectRuntimeGraph } from "../../src/graph-introspect.js";
import { createAgentGraphFixture, createNestedAgentGraphFixture } from "../fixtures/graph-fixture.js";

describe("introspectRuntimeGraph", () => {
  it("reads graph data from agent.getGraphAsync", async () => {
    const result = await introspectRuntimeGraph(createAgentGraphFixture());

    expect(result.graph?.stats.nodeCount).toBe(4);
    expect(result.graph?.stats.conditionalEdgeCount).toBe(2);
    expect(result.graph?.conditionalBranches[0]?.source).toBe("agent");
    expect(result.graph?.mermaid).toContain("flowchart");
  });

  it("falls back to agent.graph.getGraphAsync", async () => {
    const result = await introspectRuntimeGraph(createNestedAgentGraphFixture());

    expect(result.graph?.edges).toHaveLength(3);
    expect(result.warnings).toEqual([]);
  });

  it("returns a warning when no graph API is exposed", async () => {
    const result = await introspectRuntimeGraph({});

    expect(result.graph).toBeNull();
    expect(result.warnings[0]).toContain("getGraphAsync");
  });
});
