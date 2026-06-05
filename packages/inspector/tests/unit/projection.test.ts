import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectAgent } from "../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../template");

describe("projection", () => {
  it("projects middleware in the runtime construction order", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });

    expect(spec.middleware.map((item) => item.name)).toEqual([
      "memory",
      "stuck-loop",
      "fs-path-resolver",
      "periodic-reminder",
      "cost-tracking",
      "compaction",
      "eviction",
      "hooks",
    ]);
  });

  it("keeps dry-run graphless and records resource collections", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });

    expect(spec.graph).toBeNull();
    expect(spec.skills.directories.length).toBeGreaterThan(0);
    expect(spec.permissions.effectiveRules.length).toBeGreaterThan(0);
  });
});
