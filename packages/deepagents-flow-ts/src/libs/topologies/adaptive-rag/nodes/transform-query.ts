/**
 * transform_query 节点 —— 问题重写优化检索（对齐官方 Adaptive RAG 的 question_rewriter）。
 *
 * 与入口 rewrite 节点不同：rewrite 是首次意图分类 + 查询优化 + MCP 选源；transform_query 是
 * grade_documents 判 insufficient 后、重检前的"轻量重写"——只把问题改写成更适合检索的版本，
 * 不重新做意图分类。两者职责分开，循环回到 retrieve 重试。
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type AppConfig } from "../../../../runtime/index.js";
import { resolveLlmResilience } from "../../../../runtime/services/llm-resilience.js";
import { createLlmNode, requireModel } from "../../../nodes/index.js";
import type { AdaptiveRAGState } from "./types.js";

const TRANSFORM_PROMPT = `你是问题重写器。把输入问题改写成更适合向量库/搜索引擎检索的版本。
思考问题的底层语义意图，给出更具体、更完整、包含更多上下文关键词的检索问题。
只输出改写后的问题本身（不要解释、不要 JSON）。`;

/** transform_query 节点：LLM 重写 query → 写 state.rewritten_query。 */
export function createTransformQueryNode(appConfig?: AppConfig) {
  return createLlmNode<AdaptiveRAGState>({
    // 无凭证 → requireModel 抛错（model 解析在 try 外），顶层兜底；瞬态失败 → fallback 保留原 query。
    model: () => requireModel(appConfig, "adaptive-rag transform_query"),
    prompt: (s) => {
      const q = s.rewritten_query || s.query;
      return [new SystemMessage(TRANSFORM_PROMPT), new HumanMessage(`原始问题：\n${q}\n请给出优化后的检索问题。`)];
    },
    write: (r, s) => ({
      rewritten_query: r.content?.trim() || s.rewritten_query || s.query,
    }),
    fallback: (s) => ({ rewritten_query: s.rewritten_query || s.query }),
    config: appConfig,
    label: "adaptive-rag transform_query",
    attempts: 1,
    timeoutMs: resolveLlmResilience(appConfig).shortTimeoutMs,
  });
}
