/**
 * 默认 flow 测试
 *  - executeFlow：无凭证走 think fallback（回显输入），图按 prepare → think → respond 收敛。
 *  - 不依赖 LLM（强制无凭证），结果确定。
 *
 * 注：默认图现在是标准 LangGraph ReAct（prepare → think ↔ tools → respond）。
 *     有凭证时 think 用 bindTools 调模型；无凭证时 fallback 回显输入（保证图始终可跑）。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { AppConfigSchema } from "../src/runtime/index.js";
import { executeFlow } from "../src/app/graph.js";
import { createDemoTools } from "../src/app/tools/demo.tool.js";

describe("executeFlow 默认图（无凭证 fallback）", () => {
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

  const deps = {
    allTools: createDemoTools(),
    checkpointer: new MemorySaver(),
    config: AppConfigSchema.parse({}),
    systemPrompt: "",
  };

  it("无凭证 → think fallback 回显输入，收敛到 respond", async () => {
    const res = await executeFlow("hello world", deps);
    expect(res.output).toContain("hello world");
    expect(res.output).toContain("无模型凭证");
    expect(res.steps.some((s) => s.startsWith("think#"))).toBe(true);
    expect(res.steps).toContain("respond");
  });
});
