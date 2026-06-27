import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppConfigSchema, discoverSkills, discoverSubAgents } from "../src/runtime/index.js";

describe("discoverSubAgents", () => {
  it("discovers subagents from builtin/agents via agentsDirectories", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-subagent-builtin-"));
    const agentDir = join(root, "builtin", "agents", "researcher");
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
      agentsDirectories: ["./builtin"],
    });

    const found = discoverSubAgents(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("researcher");
    expect(found[0]!.description).toBe("Builtin researcher");
  });

  it("prefers builtin over .agents when subagent names collide", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-subagent-dup-"));
    const builtinDir = join(root, "builtin", "agents", "helper");
    const platformDir = join(root, ".agents", "agents", "helper");
    mkdirSync(builtinDir, { recursive: true });
    mkdirSync(platformDir, { recursive: true });
    writeFileSync(
      join(builtinDir, "AGENT.md"),
      `---
description: From builtin
---
Builtin body.`,
    );
    writeFileSync(
      join(platformDir, "AGENT.md"),
      `---
description: From platform
---
Platform body.`,
    );

    const config = AppConfigSchema.parse({
      agentsDirectories: ["./builtin", "./.agents"],
    });

    const found = discoverSubAgents(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.description).toBe("From builtin");
  });

  it("still supports flat subagents.directories (advanced)", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-subagent-flat-"));
    const flatDir = join(root, "custom-agents", "expert");
    mkdirSync(flatDir, { recursive: true });
    writeFileSync(
      join(flatDir, "AGENT.md"),
      `---
description: Flat layout
---
Expert body.`,
    );

    const config = AppConfigSchema.parse({
      subagents: { directories: ["./custom-agents/"] },
      agentsDirectories: [],
    });

    const found = discoverSubAgents(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("expert");
  });
});

describe("discoverSkills", () => {
  it("discovers skills from builtin/skills via agentsDirectories", () => {
    const root = mkdtempSync(join(tmpdir(), "flow-skill-builtin-"));
    const skillDir = join(root, "builtin", "skills", "reviewer");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: reviewer
description: Code reviewer
---
Review code.`,
    );

    const config = AppConfigSchema.parse({
      skills: { directories: [] },
      agentsDirectories: ["./builtin"],
    });

    const found = discoverSkills(config, root);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("reviewer");
  });
});
