/**
 * web_search 节点 —— 调 webSearchTool 拿外部信息（对齐官方 Adaptive RAG 的 web_search）。
 *
 * 官方用 TavilySearchResults(k=3)，本仓库用原生 webSearchTool（默认 DuckDuckGo IA，免费无 key；
 * 设 WEB_SEARCH_API_KEY 走 Tavily，见 libs/tools/web-search.tool.ts）。
 *
 * 结果转成 RetrievalResult[]（tool="web_search"），与 retrieve 节点产物同构 —— 都汇入 prepare 统一成 context。
 * web_search 不经过 grade_documents（它是兜底路径，官方亦如此）。
 */
import { webSearchTool } from "../../../tools/index.js";
import { logger } from "../../../../runtime/index.js";
import type { AdaptiveRAGState, AdaptiveRAGConfig, RetrievalResult } from "./types.js";

const log = logger.child("adaptive-rag-web-search");

/** web_search 节点：调 webSearchTool → 写 raw_results（+ attempts 计数）。 */
export async function webSearchNode(
  state: AdaptiveRAGState,
  config?: AdaptiveRAGConfig
): Promise<Partial<AdaptiveRAGState>> {
  const query = state.rewritten_query || state.query;
  // 每执行一次检索类节点就 +1，供 grade_documents 的条件边判断是否还能重试（与 retrieveNode 对齐）。
  const attempts = (state.attempts ?? 0) + 1;
  const maxResults = config?.webSearch?.maxResults ?? 3;

  try {
    const raw = (await webSearchTool.invoke({ query, maxResults })) as string;
    const parsed = JSON.parse(raw) as { text?: string; count?: number; source?: string; error?: string };
    const content = parsed.text ?? "";
    const results: RetrievalResult[] = content
      ? [
          {
            tool: "web_search",
            content,
            metadata: { source: parsed.source ?? "duckduckgo", query, count: parsed.count ?? 0 },
          },
        ]
      : [];

    log.info("web_search done", {
      backend: parsed.source,
      count: parsed.count,
      hasContent: !!content,
      error: parsed.error,
    });
    return { raw_results: results, attempts };
  } catch (err) {
    log.error("web_search failed", { error: String(err) });
    return { raw_results: [], attempts };
  }
}
