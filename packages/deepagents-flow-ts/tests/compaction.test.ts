/**
 * compaction 单测 —— 估算 + 裁剪/摘要分支（强制无凭证 → 不调模型）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { AppConfigSchema, type AppConfig } from "deepagents-app-ts/runtime";
import { estimateTokens, compactHistory } from "../src/app/compaction.js";

describe("estimateTokens", () => {
  it("按 char/4 向上取整", () => {
    expect(estimateTokens([new HumanMessage("abcd")])).toBe(1);
    expect(estimateTokens([new HumanMessage("ab")])).toBe(1);
    expect(estimateTokens([new HumanMessage("abcdefgh")])).toBe(2);
  });
});

describe("compactHistory（无凭证分支）", () => {
  const credVars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const v of credVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterAll(() => {
    for (const v of credVars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v]!;
    }
  });

  // 用小阈值测裁剪逻辑（绕过 schema 的 min(1000) 生产约束）
  const smallConfig = {
    ...AppConfigSchema.parse({}),
    compaction: {
      enabled: true,
      contextWindow: 100,
      triggerThreshold: 0.5,
      reserveTokens: 1000,
      keepRecentTokens: 10,
    },
  } as unknown as AppConfig;

  it("未超阈值 → 原样返回（同一引用）", async () => {
    const msgs = [new HumanMessage("hi"), new AIMessage("hello")];
    expect(await compactHistory(msgs, smallConfig)).toBe(msgs);
  });

  it("超阈值 + 无凭证 → 仅裁剪（结果短于原）", async () => {
    const msgs = Array.from({ length: 20 }, (_, i) => new HumanMessage(`msg-${i}-` + "x".repeat(20)));
    const result = await compactHistory(msgs, smallConfig);
    expect(result.length).toBeLessThan(msgs.length);
    expect(result.length).toBeGreaterThan(0);
  });

  it("disabled → 原样返回", async () => {
    const cfg = AppConfigSchema.parse({ compaction: { enabled: false } });
    const msgs = Array.from({ length: 20 }, (_, i) => new HumanMessage("x".repeat(50)));
    expect(await compactHistory(msgs, cfg)).toBe(msgs);
  });
});
