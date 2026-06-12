/**
 * RAG 运行助手
 *
 * 把 LoadedRagConfig 组装成图配置，并提供来源脚注格式化。
 * 被 ACP surface 和 CLI 复用，避免重复拼装逻辑。
 */

import type { CreateRAGGraphConfig } from "./graph.js";
import type { RAGResponse } from "./nodes/types.js";
import { DEFAULT_RAG_CONFIG } from "./nodes/types.js";
import type { LoadedRagConfig } from "./config.js";

/** 从 LoadedRagConfig 组装图配置（不含 callbacks）。 */
export function buildGraphConfig(
  loaded: LoadedRagConfig
): Omit<CreateRAGGraphConfig, "callbacks"> {
  const { rag, appConfig } = loaded;
  const mcpServers = (rag.mcpServers ?? {}) as CreateRAGGraphConfig["mcpServers"];
  const retrievalTools =
    rag.retrievalTools && rag.retrievalTools.length > 0
      ? rag.retrievalTools
      : Object.keys(mcpServers);

  return {
    ...DEFAULT_RAG_CONFIG,
    enabled: rag.enabled ?? DEFAULT_RAG_CONFIG.enabled,
    retrievalTools,
    rewrite: { ...DEFAULT_RAG_CONFIG.rewrite, ...rag.rewrite } as CreateRAGGraphConfig["rewrite"],
    retrieve: { ...DEFAULT_RAG_CONFIG.retrieve, ...rag.retrieve },
    prepare: { ...DEFAULT_RAG_CONFIG.prepare, ...rag.prepare },
    agent: { ...DEFAULT_RAG_CONFIG.agent, ...rag.agent },
    mcpServers,
    appConfig,
  };
}

/** 来源脚注（流式回答之后追加）。无来源时返回空串。 */
export function formatSourcesFooter(response: RAGResponse): string {
  if (!response.sources || response.sources.length === 0) {
    return "";
  }
  let out = "\n\n---\n**来源:**\n";
  response.sources.forEach((s, i) => {
    out += `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n`;
  });
  return out;
}
