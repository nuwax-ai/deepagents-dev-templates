/**
 * 工作流图集成测试
 *
 * 跑真实编译后的 LangGraph 图（executeRAG），只 mock：
 *  - deepagents-app-ts/runtime 的 resolveModel → 假模型（rewrite/generate 不打真实 LLM）
 *  - retrieve 节点 → 受控检索结果（不 spawn MCP）
 *
 * 验证：条件边的"重试一次后收敛"与"足够则不重试且带来源"。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const counters = { rewrite: 0, generate: 0 };
  const fakeModel = {
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const sys = String(messages?.[0]?.content ?? "");
      // rewrite 节点的 system prompt 含"查询分析专家"
      if (sys.includes("查询分析专家")) {
        counters.rewrite++;
        return {
          content: '{"rewritten_query":"refined q","intent":"factual","keywords":["x"]}',
        };
      }
      counters.generate++;
      return { content: "基于上下文生成的回答。" };
    },
    // 测试不传 onToken，走 invoke 分支；stream 仅占位
    stream: async function* () {
      yield { content: "x" };
    },
  };
  const retrieve = { results: [] as Array<{ tool: string; content: string }> };
  return { counters, fakeModel, retrieve };
});

vi.mock("deepagents-app-ts/runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveModel: () => h.fakeModel };
});

vi.mock("../nodes/retrieve.js", () => ({
  retrieveNode: async (state: { attempts?: number }) => ({
    raw_results: h.retrieve.results,
    attempts: (state.attempts ?? 0) + 1,
  }),
}));

import { executeRAG, type CreateRAGGraphConfig } from "../graph.js";
import { DEFAULT_RAG_CONFIG } from "../nodes/types.js";

function makeConfig(): CreateRAGGraphConfig {
  return {
    ...DEFAULT_RAG_CONFIG,
    retrievalTools: ["stub"],
    mcpServers: {},
    appConfig: {
      model: { provider: "openai", name: "stub", settings: { temperature: 0 } },
    } as unknown as CreateRAGGraphConfig["appConfig"],
  };
}

beforeEach(() => {
  h.counters.rewrite = 0;
  h.counters.generate = 0;
  h.retrieve.results = [];
});

describe("executeRAG workflow graph", () => {
  it("检索不足时重试 rewrite 恰好一次后收敛到 generate", async () => {
    h.retrieve.results = []; // 始终空 → insufficient
    const res = await executeRAG("空检索问题", { config: makeConfig() });

    expect(h.counters.rewrite).toBe(2); // 1 次初始 + 1 次重试（受 MAX_RETRIEVE_ATTEMPTS 限制）
    expect(h.counters.generate).toBe(1); // 达上限后仍进入 generate
    expect(typeof res.answer).toBe("string");
    expect(res.answer.length).toBeGreaterThan(0);
  });

  it("检索足够时不重试，且回答带来源", async () => {
    h.retrieve.results = [
      { tool: "stub", content: "一段足够长的上下文内容，用于生成回答并产出来源。" },
    ];
    const res = await executeRAG("有结果的问题", { config: makeConfig() });

    expect(h.counters.rewrite).toBe(1); // 无重试
    expect(h.counters.generate).toBe(1);
    expect(res.sources.length).toBeGreaterThan(0);
  });
});
