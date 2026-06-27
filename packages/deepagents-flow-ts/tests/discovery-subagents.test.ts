import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppConfigSchema, discoverSubAgents } from "../src/runtime/index.js";

describe("discoverSubAgents", () => {
  it("discovers subagents from agents/builtin/", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-subagent-builtin-"));
    const agentDir = join(root, "agents", "builtin", "researcher");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "AGENT.md"),
      `---
name: researcher
description: Builtin researcher
---
You research things.`,
    );

    const config = AppConfigSchema.parse({
      subagents: { directories: ["./agents/builtin/"] },
      agentsDirectories: [],
    });

    const found = discoverSubAgents(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("researcher");
    expect(found[0]!.description).toBe("Builtin researcher");
  });

  it("prefers first path when subagent names collide", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-subagent-dup-"));
    const builtinDir = join(root, "agents", "builtin", "helper");
    const agentsDir = join(root, ".agents", "agents", "helper");
    mkdirSync(builtinDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(builtinDir, "AGENT.md"),
      `---
description: From builtin
---
Builtin body.`,
    );
    writeFileSync(
      join(agentsDir, "AGENT.md"),
      `---
description: From agents dir
---
Agents dir body.`,
    );

    const config = AppConfigSchema.parse({
      subagents: { directories: ["./agents/builtin/"] },
      agentsDirectories: ["./.agents"],
    });

    const found = discoverSubAgents(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.description).toBe("From builtin");
  });
});
