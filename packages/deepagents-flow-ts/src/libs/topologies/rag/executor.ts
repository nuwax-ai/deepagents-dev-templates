/**
 * rag 拓扑执行器（one-shot FlowExecutor）+ 来源脚注（自 examples/rag/run-rag.ts 提升）。
 *
 * rag 是检索增强 one-shot：rewrite → retrieve(MCP) → grade(重试) → prepare → generate。
 * scaffold 生成的 flow 用 createRagExecutor（mcpServers 驱动，不需 rag 配置文件）；
 * example 的 config-file-driven 入口仍在 examples/rag/{config,run-rag,index}.ts。
 *
 * spec.systemPrompt 不注入：rag 的 rewrite/generate 节点是领域 RAG prompt（检索+规则），
 * 通用 persona 不适配检索范式（计划：多 LLM 节点拓扑保留领域 prompt）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import { executeRAG, type CreateRAGGraphConfig } from "./graph.js";
import { DEFAULT_RAG_CONFIG, type RAGResponse } from "./nodes/types.js";

/** rag 检索 MCP 服务器配置（语义名 → server 配置）；scaffold spec.params.mcpServers 提供。 */
export interface RagExecutorOptions {
  /** 检索源 MCP 服务器（如 { context7: {...}, "duckduckgo": {...} }）。 */
  mcpServers?: CreateRAGGraphConfig["mcpServers"];
  /** 显式检索工具名；缺省取 mcpServers 的 key。 */
  retrievalTools?: string[];
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

/**
 * 把 rag 图包成通用 FlowExecutor（scaffold 生成的 flow 用）。
 * mcpServers 缺省空 → retrieve 无工具、grade 判 insufficient、走兜底回答（仍可跑通）。
 */
export function createRagExecutor(
  runtime: FlowRuntime,
  opts: RagExecutorOptions = {}
): FlowExecutor {
  const mcpServers = opts.mcpServers ?? {};
  const graphConfig: Omit<CreateRAGGraphConfig, "callbacks"> = {
    ...DEFAULT_RAG_CONFIG,
    retrievalTools: opts.retrievalTools ?? Object.keys(mcpServers),
    mcpServers,
    appConfig: runtime.config,
  };

  return async (query, { onToken, onToolCall } = {}) => {
    const res = await executeRAG(query, {
      config: { ...graphConfig },
      callbacks: { onToken, onToolCall },
    });
    return { answer: res.answer, footer: formatSourcesFooter(res) };
  };
}
