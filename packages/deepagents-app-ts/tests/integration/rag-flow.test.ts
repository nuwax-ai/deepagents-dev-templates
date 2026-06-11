/**
 * RAG 流程集成测试
 */

import { describe, it, expect, vi } from "vitest";
import { createRAGGraph, executeRAG } from "../../src/app/graph.js";
import { DEFAULT_RAG_CONFIG } from "../../src/app/nodes/types.js";

// Mock 所有 LLM 调用
vi.mock("@langchain/anthropic", () => {
  return {
    ChatAnthropic: vi.fn().mockImplementation(() => ({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          rewritten_query: "机器学习的定义和应用",
          intent: "factual",
          keywords: ["机器学习", "人工智能"],
          mcp_hint: "context7",
        }),
      }),
      stream: vi.fn().mockImplementation(async function* () {
        yield { content: "机器学习是" };
        yield { content: "人工智能的一个分支" };
        yield { content: "，它使计算机能够从数据中学习。" };
      }),
    })),
  };
});

// Mock MCP 调用
vi.mock("../../src/app/nodes/retrieve.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    retrieveNode: vi.fn().mockImplementation(async (state: any) => {
      // 如果没有配置工具，返回空结果
      if (!state.mcp_hint && !state.intent) {
        return { raw_results: [] };
      }
      return {
        raw_results: [
          {
            tool: "context7",
            content: JSON.stringify({
              result: "机器学习是人工智能的一个子领域...",
            }),
            metadata: { server: "context7", query: state.query },
          },
        ],
      };
    }),
  };
});

const TEST_MCP_SERVERS = {
  "howtocook-mcp": {
    command: "npx",
    args: ["-y", "howtocook-mcp"],
    enabled: true,
  },
  context7: {
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    enabled: true,
  },
};

describe("RAG Flow Integration", () => {
  it("should create a valid graph", () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: TEST_MCP_SERVERS,
      retrievalTools: ["context7", "howtocook-mcp"],
    };
    const graph = createRAGGraph(config);
    expect(graph).toBeDefined();
  });

  it("should execute full RAG flow", async () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: TEST_MCP_SERVERS,
      retrievalTools: ["context7", "howtocook-mcp"],
    };

    const result = await executeRAG("什么是机器学习？", { config });

    expect(result).toHaveProperty("answer");
    expect(result).toHaveProperty("sources");
    expect(result).toHaveProperty("metadata");
    expect(result.metadata).toHaveProperty("duration_ms");
    expect(result.metadata).toHaveProperty("tools_used");
  });

  it("should include metadata in response", async () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: TEST_MCP_SERVERS,
      retrievalTools: ["context7"],
    };

    const result = await executeRAG("测试问题", { config });

    expect(result.metadata).toBeDefined();
    expect(result.metadata.duration_ms).toBeGreaterThan(0);
    expect(Array.isArray(result.metadata.tools_used)).toBe(true);
  });

  it("should calculate confidence score", async () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: TEST_MCP_SERVERS,
      retrievalTools: ["context7"],
    };

    const result = await executeRAG("什么是机器学习？", { config });

    expect(result.confidence).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("should use howtocook-mcp for how_to intent", async () => {
    const config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: TEST_MCP_SERVERS,
      retrievalTools: ["context7", "howtocook-mcp"],
    };

    // Mock how_to intent
    const { ChatAnthropic } = await import("@langchain/anthropic");
    vi.mocked(ChatAnthropic).mockImplementation(() => ({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          rewritten_query: "如何做红烧肉",
          intent: "how_to",
          keywords: ["红烧肉", "烹饪"],
          mcp_hint: "howtocook-mcp",
        }),
      }),
      stream: vi.fn(),
    }) as any);

    const result = await executeRAG("红烧肉怎么做？", { config });

    expect(result).toHaveProperty("answer");
  });
});
