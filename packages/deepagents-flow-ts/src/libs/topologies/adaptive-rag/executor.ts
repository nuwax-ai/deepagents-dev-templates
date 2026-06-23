/**
 * adaptive-rag 拓扑执行器（one-shot FlowExecutor）—— 对照 rag/executor.ts。
 *
 * adaptive-rag 是检索增强 + 自适应路由 + 生成后自纠正的 one-shot：
 *   rewrite → route_question →{web_search|retrieve} → grade_documents →{transform_query|prepare}
 *   → generate → grade_generation →{useful:END|not_supported:generate|not_useful:transform_query}
 *
 * scaffold 生成的 flow 用 createAdaptiveRagExecutor（mcpServers 驱动，不需 rag 配置文件）。
 * spec.systemPrompt 不注入（同 rag）：adaptive-rag 的 rewrite/route/grade/generate 是领域 RAG prompt。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import { executeAdaptiveRAG, type CreateAdaptiveRAGGraphConfig } from "./graph.js";
import { DEFAULT_ADAPTIVE_RAG_CONFIG } from "./nodes/types.js";
import { formatSourcesFooter } from "../rag/executor.js";
import type { RAGResponse } from "../rag/nodes/types.js";

/** adaptive-rag 检索 MCP 服务器配置（语义名 → server 配置）；scaffold spec.params.mcpServers 提供。 */
export interface AdaptiveRagExecutorOptions {
  /** 检索源 MCP 服务器（如 { context7: {...} }）。 */
  mcpServers?: CreateAdaptiveRAGGraphConfig["mcpServers"];
  /** 显式检索工具名；缺省取 mcpServers 的 key。 */
  retrievalTools?: string[];
}

/**
 * 把 adaptive-rag 图包成通用 FlowExecutor（scaffold 生成的 flow 用）。
 * mcpServers 缺省空 → retrieve 无工具、grade 判 insufficient、走 transform_query/兜底回答（仍可跑通）。
 */
export function createAdaptiveRagExecutor(
  runtime: FlowRuntime,
  opts: AdaptiveRagExecutorOptions = {}
): FlowExecutor {
  const mcpServers = opts.mcpServers ?? {};
  const graphConfig: Omit<CreateAdaptiveRAGGraphConfig, "callbacks"> = {
    ...DEFAULT_ADAPTIVE_RAG_CONFIG,
    retrievalTools: opts.retrievalTools ?? Object.keys(mcpServers),
    mcpServers,
    appConfig: runtime.config,
  };

  return async (query, { onToken, onToolCall } = {}) => {
    const res: RAGResponse = await executeAdaptiveRAG(query, {
      config: { ...graphConfig },
      callbacks: { onToken, onToolCall },
    });
    return { answer: res.answer, footer: formatSourcesFooter(res) };
  };
}
