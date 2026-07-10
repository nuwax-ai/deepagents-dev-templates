import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { resolveSkillReferencePath } from "../src/libs/tools/skill.tool.js";

describe("resolveSkillReferencePath", () => {
  it("按完整文件名解析 references 子文件", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-ref-"));
    const refs = join(root, "references");
    mkdirSync(refs, { recursive: true });
    writeFileSync(join(refs, "part0-workflow.md"), "# part0");

    expect(resolveSkillReferencePath(root, "part0-workflow.md")).toBe(join(refs, "part0-workflow.md"));
    expect(resolveSkillReferencePath(root, "part0-workflow")).toBe(join(refs, "part0-workflow.md"));
  });

  it("按前缀解析 partN 简写", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-ref-"));
    const refs = join(root, "references");
    mkdirSync(refs, { recursive: true });
    writeFileSync(join(refs, "part3-tools-config.md"), "# part3");

    expect(resolveSkillReferencePath(root, "part3")).toBe(join(refs, "part3-tools-config.md"));
  });

  it("无 references 目录时返回 null", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-ref-"));
    expect(resolveSkillReferencePath(root, "part0")).toBeNull();
  });
});
