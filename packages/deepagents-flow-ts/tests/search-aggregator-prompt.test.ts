import { describe, expect, it } from "vitest";
import { composeSystemPrompt } from "../src/app/flows/search-aggregator/index.js";

/** 护栏关键句，用于断言「如实性」约束始终存在。 */
const GUARDRAIL_MARKER = "禁止编造来源或链接";

describe("search-aggregator composeSystemPrompt", () => {
  it("无平台提示词时使用本地 fallback，且含护栏", () => {
    const out = composeSystemPrompt(undefined);
    expect(out).toContain("搜索聚合助手");
    expect(out).toContain(GUARDRAIL_MARKER);
    // fallback 正文已内嵌护栏，不应重复追加第二段「如实性（不可协商）」标题。
    expect(out.match(/## 如实性/g)?.length).toBe(1);
  });

  it("平台提示词为空白时回退 fallback", () => {
    const out = composeSystemPrompt("   \n  ");
    expect(out).toContain("搜索聚合助手");
    expect(out).toContain(GUARDRAIL_MARKER);
  });

  it("有平台提示词时采用平台内容并强制追加护栏", () => {
    const platform = "你是平台定制的搜索助手。";
    const out = composeSystemPrompt(platform);
    expect(out.startsWith(platform)).toBe(true);
    expect(out).toContain(GUARDRAIL_MARKER);
    expect(out).toContain("## 如实性（不可协商）");
    expect(out).not.toContain("搜索聚合助手");
  });

  it("平台提示词 trim 后拼接护栏", () => {
    const out = composeSystemPrompt("  平台提示  ");
    expect(out.startsWith("平台提示")).toBe(true);
    expect(out).toContain(GUARDRAIL_MARKER);
  });
});
