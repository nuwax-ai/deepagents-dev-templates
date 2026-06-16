/**
 * deep-research 调研工具 —— LangChain StructuredTool 封装 DuckDuckGo MCP。
 *
 * 框架优先：搜索走 `tool()` + Zod schema，由 ToolNode / bindTools 调度。
 * 韧性：MCP 瞬断（TLS/socket）指数退避重试；最终仍失败则返回可读降级文本、不抛错，
 * 与旧版 runTool 行为一致，避免整条 research 子图因一次网络抖动而中断。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../../../../src/runtime/index.js";
import { withRetry } from "../../../shared.js";
import {
  callResolvedMcpTool,
  rateLimited,
  type McpServerConfig,
} from "../../../mcp-client.js";

const log = logger.child("deep-research-search");

/** 单次 MCP 搜索超时（毫秒）。 */
export const SEARCH_TIMEOUT_MS = 20000;

/** MCP 搜索重试次数（覆盖 TLS 瞬断、socket reset 等）。 */
const SEARCH_RETRY_ATTEMPTS = 3;

/** 网络搜索 MCP（duckduckgo-mcp-server，免 key；与 travel-planner 同源）。 */
export const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

/**
 * 调 DuckDuckGo MCP（rateLimited + 重试）。
 * 供 StructuredTool 与单测复用。
 */
export async function invokeDuckDuckGoSearch(
  query: string,
  count = 5
): Promise<{ text: string; ok: boolean }> {
  try {
    const text = await rateLimited(() =>
      withRetry(
        () =>
          callResolvedMcpTool(
            SEARCH_MCP,
            "duckduckgo_search",
            { query, count },
            { timeoutMs: SEARCH_TIMEOUT_MS }
          ),
        {
          attempts: SEARCH_RETRY_ATTEMPTS,
          baseDelayMs: 1200,
          label: "duckduckgo_search MCP",
        }
      )
    );
    const trimmed = text.trim();
    if (!trimmed || /^Unknown tool:/i.test(trimmed)) {
      return { text: `（搜索无结果或工具不可用：${trimmed || query}）`, ok: false };
    }
    return { text: trimmed.slice(0, 1200), ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("duckduckgo_search 失败 → 降级", { query, error: message });
    return {
      text: `（搜索失败：${message}；将基于主题常识整理）`,
      ok: false,
    };
  }
}

/**
 * 创建 duckduckgo_search StructuredTool。
 * rateLimited 保证并行 Send 扇出时外部请求仍错峰（DDG 约 1 req/s）。
 */
export function createDuckDuckGoSearchTool() {
  return tool(
    async ({ query, count }) => {
      const { text } = await invokeDuckDuckGoSearch(query, count ?? 5);
      return text;
    },
    {
      name: "duckduckgo_search",
      description:
        "Search the web via DuckDuckGo. Use English keywords when possible. Returns text snippets.",
      schema: z.object({
        query: z.string().describe("Search query keywords"),
        count: z.number().optional().describe("Number of results (default 5)"),
      }),
    }
  );
}
