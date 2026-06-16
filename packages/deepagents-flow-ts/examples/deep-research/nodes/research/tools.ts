/**
 * deep-research 调研工具 —— LangChain StructuredTool 封装 DuckDuckGo MCP。
 *
 * 框架优先：搜索走 `tool()` + Zod schema。
 * 韧性：全局 rateLimited 串行（Send 并行时仍错峰）+ DDG 限流正文检测与长退避重试；
 * 最终失败返回可读降级文本、不抛错，避免整条 research 子图中断。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../../../../src/runtime/index.js";
import {
  callResolvedMcpTool,
  rateLimited,
  type McpServerConfig,
} from "../../../mcp-client.js";

const log = logger.child("deep-research-search");

/** 单次 MCP 搜索超时（毫秒）。 */
export const SEARCH_TIMEOUT_MS = 20000;

/** MCP 搜索重试次数（含 DDG 限流退避）。 */
const SEARCH_RETRY_ATTEMPTS = 4;

/**
 * DDG 免费 API 建议间隔；Send 扇出 N 路时由 rateLimited 全局闸门串行，
 * 间隔过短会触发 "making requests too quickly"。
 */
const DDG_MIN_GAP_MS = 4500;

/** 网络搜索 MCP（duckduckgo-mcp-server，免 key；与 travel-planner 同源）。 */
export const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

/**
 * DDG 常以 200 + 正文 `Error: ...` 返回限流/异常（不抛 MCP 异常）。
 * 导出供单测与子图降级判断。
 */
export function isDdgErrorText(text: string): boolean {
  const t = text.trim();
  return (
    /^Error:/i.test(t) ||
    /anomaly|too quickly|rate.?limit|blocked|captcha/i.test(t)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 调 DuckDuckGo MCP（rateLimited 串行 + DDG 限流退避重试）。
 * 每章节只应调用一次（见 subgraph 确定性 search 节点）。
 */
export async function invokeDuckDuckGoSearch(
  query: string,
  count = 5
): Promise<{ text: string; ok: boolean }> {
  let lastFail = "";

  for (let attempt = 0; attempt < SEARCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const text = await rateLimited(
        () =>
          callResolvedMcpTool(
            SEARCH_MCP,
            "duckduckgo_search",
            { query, count },
            { timeoutMs: SEARCH_TIMEOUT_MS }
          ),
        DDG_MIN_GAP_MS
      );
      const trimmed = text.trim();

      if (!trimmed || /^Unknown tool:/i.test(trimmed)) {
        return {
          text: `（搜索无结果或工具不可用：${trimmed || query}）`,
          ok: false,
        };
      }

      if (isDdgErrorText(trimmed)) {
        lastFail = trimmed;
        const waitMs = 8000 * (attempt + 1);
        log.warn("DDG 限流/异常 → 退避重试", {
          query,
          attempt: attempt + 1,
          waitMs,
          snippet: trimmed.slice(0, 120),
        });
        if (attempt < SEARCH_RETRY_ATTEMPTS - 1) {
          await sleep(waitMs);
          continue;
        }
        return {
          text: `（搜索失败：${trimmed}；将基于主题常识整理）`,
          ok: false,
        };
      }

      return { text: trimmed.slice(0, 1200), ok: true };
    } catch (err) {
      lastFail = err instanceof Error ? err.message : String(err);
      log.warn("duckduckgo_search MCP 抛错", { query, attempt: attempt + 1, error: lastFail });
      if (attempt < SEARCH_RETRY_ATTEMPTS - 1) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
    }
  }

  return {
    text: `（搜索失败：${lastFail}；将基于主题常识整理）`,
    ok: false,
  };
}

/** 创建 duckduckgo_search StructuredTool（供 bindTools / 直调 invoke）。 */
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
