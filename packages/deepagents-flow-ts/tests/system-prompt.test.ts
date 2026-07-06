/**
 * resolveSystemPromptMeta —— ACP session 提示词追加语义（不覆盖本地 flow.base.md）。
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppConfigSchema } from "../src/runtime/config/config-schema.js";
import { resolveSystemPromptMeta } from "../src/runtime/context/prompt.js";
import { PLATFORM_CONVENTIONS } from "../src/runtime/context/harness-profile.js";
import { resolvePackageRoot } from "../src/runtime/package-root.js";

describe("resolveSystemPromptMeta — ACP session append", () => {
  const pkgRoot = resolvePackageRoot(import.meta.url);

  it("有 session prompt + 本地 flow.base.md → 身份在前、session 追加、PLATFORM_CONVENTIONS 在后", () => {
    const config = AppConfigSchema.parse({});
    const meta = resolveSystemPromptMeta(
      config,
      { systemPrompt: "平台补充指令" },
      pkgRoot
    );

    expect(meta.source).toBe("acp-session");
    expect(meta.prompt).toContain("LangGraph 工作流图");
    expect(meta.prompt.indexOf("LangGraph 工作流图")).toBeLessThan(
      meta.prompt.indexOf("平台补充指令")
    );
    expect(meta.prompt.indexOf("平台补充指令")).toBeLessThan(
      meta.prompt.indexOf("Tool Selection Priority")
    );
    expect(meta.prompt).toContain(PLATFORM_CONVENTIONS);
  });

  it("有 session prompt + 提示词文件不存在 → 仅 session + PLATFORM_CONVENTIONS", () => {
    const workspace = mkdtempSync(join(tmpdir(), "flow-prompt-test-"));
    const config = AppConfigSchema.parse({
      agent: { systemPromptPath: "prompts/missing-flow.base.md" },
    });

    const meta = resolveSystemPromptMeta(
      config,
      { systemPrompt: "仅平台指令" },
      workspace
    );

    expect(meta.source).toBe("acp-session");
    expect(meta.prompt).toBe(`仅平台指令\n\n${PLATFORM_CONVENTIONS}`);
  });

  it("无 session prompt → 从 flow.base.md 加载（config-file）", () => {
    const config = AppConfigSchema.parse({});
    const meta = resolveSystemPromptMeta(config, undefined, pkgRoot);

    expect(meta.source).toBe("config-file");
    expect(meta.prompt).toContain("LangGraph 工作流图");
    expect(meta.prompt).not.toContain(PLATFORM_CONVENTIONS);
  });

  it("自定义 systemPromptPath 在 ACP session 下仍被加载为 base", () => {
    const workspace = mkdtempSync(join(tmpdir(), "flow-prompt-custom-"));
    mkdirSync(join(workspace, "prompts"), { recursive: true });
    writeFileSync(
      join(workspace, "prompts/custom.md"),
      "# Title\n\n自定义 Agent 身份\n",
      "utf-8"
    );
    const config = AppConfigSchema.parse({
      agent: { systemPromptPath: "prompts/custom.md" },
    });

    const meta = resolveSystemPromptMeta(
      config,
      { systemPrompt: "ACP 追加" },
      workspace
    );

    expect(meta.source).toBe("acp-session");
    expect(meta.prompt).toMatch(/^自定义 Agent 身份/);
    expect(meta.prompt).toContain("ACP 追加");
  });
});
