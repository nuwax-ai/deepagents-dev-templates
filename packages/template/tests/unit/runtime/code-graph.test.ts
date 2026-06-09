import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateCodeGraph } from "../../../src/runtime/code-graph.js";

describe("code graph", () => {
  it("generates a nuwaclaw-readable graph for the template", () => {
    const graph = generateCodeGraph(process.cwd());
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    const edgeIds = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}:${edge.kind}`));

    expect(graph.schema).toBe("nuwaclaw.agent-code-graph.v1");
    expect(nodeIds).toContain("entry:index");
    expect(nodeIds).toContain("runtime:acp-server");
    expect(nodeIds).toContain("runtime:code-graph");
    expect(nodeIds).toContain("runtime:harness-lifecycle");
    expect(nodeIds).toContain("tool:platform-api");
    expect(nodeIds).toContain("tool:mcp-bridge");
    expect(nodeIds).toContain("config:mcp");
    expect(nodeIds).toContain("manifest:package");
    expect(nodeIds).toContain("skill:platform-tool-selection");

    expect(edgeIds).toContain("entry:index->runtime:acp-server:calls");
    expect(edgeIds).toContain("runtime:helpers->tool:platform-api:loads");
    expect(edgeIds).toContain("runtime:mcp-manager->config:mcp:loads");
    expect(edgeIds).toContain("runtime:helpers->runtime:harness-lifecycle:configures");
    expect(edgeIds).toContain("script:package->manifest:package:packages");
  });

  it("reads skill scan roots from config.skills.directories, not hardcoded paths", () => {
    const root = mkdtempSync(join(tmpdir(), "code-graph-skills-"));
    try {
      mkdirSync(join(root, "config"), { recursive: true });
      writeFileSync(
        join(root, "config/app-agent.config.json"),
        JSON.stringify({ skills: { directories: ["./custom-skills"] } })
      );
      // A skill under the configured dir...
      mkdirSync(join(root, "custom-skills/my-custom-skill"), { recursive: true });
      writeFileSync(join(root, "custom-skills/my-custom-skill/SKILL.md"), "---\nname: my-custom-skill\n---\n");
      // ...and one under the old hardcoded dir, which config no longer points at.
      mkdirSync(join(root, "skills/builtin/should-be-ignored"), { recursive: true });
      writeFileSync(join(root, "skills/builtin/should-be-ignored/SKILL.md"), "---\nname: should-be-ignored\n---\n");

      const skillIds = generateCodeGraph(root)
        .nodes.filter((node) => node.kind === "skill")
        .map((node) => node.id);

      expect(skillIds).toContain("skill:my-custom-skill");
      expect(skillIds).not.toContain("skill:should-be-ignored");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
