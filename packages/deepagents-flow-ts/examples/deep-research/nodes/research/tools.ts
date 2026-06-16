/**
 * deep-research 调研工具 —— LangChain StructuredTool 封装 DuckDuckGo MCP。
 *
 * 框架优先：搜索走 `tool()` + Zod schema，由 ToolNode / bindTools 调度，
 * 不再在节点里手写 callResolvedMcpTool。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  callResolvedMcpTool,
  rateLimited,
  type McpServerConfig,
} from "../../../mcp-client.js";

/** 单次 MCP 搜索超时（毫秒）。 */
export const SEARCH_TIMEOUT_MS = 20000;

/** 网络搜索 MCP（duckduckgo-mcp-server，免 key；与 travel-planner 同源）。 */
export const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

/**
 * 创建 duckduckgo_search StructuredTool。
 * rateLimited 保证并行 Send 扇出时外部请求仍错峰（DDG 约 1 req/s）。
 */
export function createDuckDuckGoSearchTool() {
  return tool(
    async ({ query, count }) => {
      const text = await rateLimited(() =>
        callResolvedMcpTool(
          SEARCH_MCP,
          "duckduckgo_search",
          { query, count: count ?? 5 },
          { timeoutMs: SEARCH_TIMEOUT_MS }
        )
      );
      return text.slice(0, 1200);
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
