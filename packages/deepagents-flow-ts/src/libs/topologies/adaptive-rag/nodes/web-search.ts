/**
 * web_search 节点 —— 经平台登记的搜索 MCP 拿外部信息（对齐官方 Adaptive RAG 的 web_search 路由）。
 *
 * 联网搜索须在**平台侧**登记；searchMcp 由 app 层注入（同 travel-planner）。
 * 未配置 searchMcp → 优雅降级（raw_results 为空，不崩）。
 *
 * 结果转成 RetrievalResult[]（tool="web_search"），与 retrieve 节点产物同构 —— 都汇入 prepare。
 * web_search 不经过 grade_documents（它是兜底路径，官方亦如此）。
 */
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { createMcpRetrievalNode } from "../../../nodes/index.js";
import { logger } from "../../../../runtime/index.js";
import type { TravelSearchMcp } from "../../travel-planner/graph.js";
import type { AdaptiveRAGState, RetrievalResult } from "./types.js";

const log = logger.child("adaptive-rag-web-search");

/** 默认单次搜索返回条数（传给 MCP search 工具的 count 参数）。 */
const DEFAULT_SEARCH_COUNT = 3;

/**
 * 造 web_search 节点：searchMcp 缺省 → retrieve 跳过，写回空 raw_results。
 * @param searchMcp 平台登记的搜索 MCP（{ config, tool }）；未传则优雅降级。
 */
export function createWebSearchNode(searchMcp?: TravelSearchMcp) {
  const inner = createMcpRetrievalNode<AdaptiveRAGState>({
    mcpServers: searchMcp ? { search: searchMcp.config } : {},
    retrieve: (s) => {
      if (!searchMcp) return null;
      const query = s.rewritten_query || s.query;
      return {
        server: "search",
        tool: searchMcp.tool,
        args: { query, count: DEFAULT_SEARCH_COUNT },
      };
    },
    write: (r, s) => {
      const query = s.rewritten_query || s.query;
      const attempts = (s.attempts ?? 0) + 1;
      if (!searchMcp) {
        log.warn("web_search skipped: 请至平台查找并添加搜索 MCP，再在 app 层配置 searchMcp");
        return { raw_results: [], attempts };
      }
      const content = r.ok ? r.text : "";
      const results: RetrievalResult[] = content
        ? [
            {
              tool: "web_search",
              content,
              metadata: { source: "mcp_search", query },
            },
          ]
        : [];
      log.info("web_search done", { hasContent: !!content, ok: r.ok });
      return { raw_results: results, attempts };
    },
    label: "web_search",
  });

  return async (state: AdaptiveRAGState, config?: LangGraphRunnableConfig) => inner(state, config);
}
