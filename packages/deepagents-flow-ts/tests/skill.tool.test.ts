/**
 * load_skill 工具回归 —— 返回 skillRoot/scriptsDir 元信息。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillTool } from "../src/libs/tools/skill.tool.js";

describe("createSkillTool", () => {
  let root: string;
  let skillDir: string;
  let skillPath: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "skill-tool-"));
    skillDir = join(root, "demo-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    skillPath = join(skillDir, "SKILL.md");
    writeFileSync(skillPath, "---\nname: demo\ndescription: test\n---\n\n# Demo body\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("返回 skillRoot、scriptsDir 与正文", async () => {
    const tool = createSkillTool([
      { name: "demo", description: "test", path: skillPath },
    ]);
    const result = String(await tool.invoke({ name: "demo" }));
    expect(result).toContain("skillRoot");
    expect(result).toContain(skillDir);
    expect(result).toContain("scriptsDir");
    expect(result).toContain(join(skillDir, "scripts"));
    expect(result).toContain("# Demo body");
    expect(result.indexOf("skillRoot")).toBeLessThan(result.indexOf("# Demo body"));
  });

  it("未知 skill 返回错误", async () => {
    const tool = createSkillTool([
      { name: "demo", description: "test", path: skillPath },
    ]);
    const result = String(await tool.invoke({ name: "missing" }));
    expect(result).toMatch(/未找到 skill/);
  });
});
