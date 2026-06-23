/**
 * Adaptive RAG 工作流图 —— 对齐官方 LangGraph Adaptive RAG 的完整自纠正结构。
 *
 *   START → rewrite → route_question ─── web_search ─────────────────────────┐
 *                          │                                                │
 *                          └─ retrieve → grade_documents ──transform_query──→ retrieve (循环)
 *                                                │         │
 *                                                │         └─(有相关)→ prepare ←──┘ (web 结果也汇入)
 *                                                │                  │
 *                                                └─────────────→ generate
 *                                                                   │
 *                                                            grade_generation ── useful ──→ END
 *                                                                   ├── not_supported ──→ generate (循环重试)
 *                                                                   └── not_useful ────→ transform_query → retrieve
 *
 * 三条条件边（纯函数 addConditionalEdges，与 rag/graph.ts 风格一致；不用 Command goto）：
 *  - route_question → { web_search | retrieve }
 *  - grade_documents → { transform_query(全不相关 & 未达上限) | prepare }
 *  - grade_generation → { useful→END | not_supported→generate | not_useful→transform_query }
 *
 * 复用 rag 的 rewrite / retrieve / prepare / generate（图逻辑单一权威在 libs/topologies/rag/），
 * 本拓扑只新增自适应路由与评分节点。
 */
import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../runtime/index.js";
// 复用 rag 节点
import { createRewriteNode } from "../rag/nodes/rewrite.js";
import { retrieveNode, type RetrieveNodeConfig } from "../rag/nodes/retrieve.js";
import { prepareNode } from "../rag/nodes/prepare.js";
import { generateNode } from "../rag/nodes/generate.js";
import type {
  RAGMetadata,
  Source,
  RetrievalResult,
  RAGResponse,
} from "../rag/nodes/types.js";
// 本拓扑节点
import {
  createRouteQuestionNode,
  routeAfterRouteQuestion,
  webSearchNode,
  gradeDocumentsNode,
  routeAfterGradeDocuments,
  createTransformQueryNode,
  gradeGenerationNode,
  routeAfterGradeGeneration,
} from "./nodes/index.js";
import type { AdaptiveRAGConfig } from "./nodes/types.js";

import type { ToolCallEvent } from "../../../core/flow-types.js";

// ACP stdio 模式下 stdout 是协议通道，日志必须走 logger（stderr）
const log = logger.child("adaptive-rag-graph");

/** Adaptive RAG State 定义（图的 channels）—— RAGState 全字段 + 自适应路由/评分字段。 */
const AdaptiveRAGStateAnnotation = Annotation.Root({
  // 输入
  query: Annotation<string>,
  history: Annotation<BaseMessage[]>,

  // Rewrite 输出（复用 rag）
  rewritten_query: Annotation<string>,
  intent: Annotation<string>,
  keywords: Annotation<string[]>,
  mcp_hint: Annotation<string>,

  // Retrieve / web_search 输出
  raw_results: Annotation<RetrievalResult[]>,

  // 编排控制（条件边）
  attempts: Annotation<number>,
  grade: Annotation<string>,

  // Prepare 输出
  context: Annotation<string>,
  sources: Annotation<Source[]>,
  token_count: Annotation<number>,

  // Generate 输出
  answer: Annotation<string>,

  // 元数据
  metadata: Annotation<RAGMetadata>,

  // ── Adaptive 自适应新增 ──
  route: Annotation<"web_search" | "vectorstore">,
  generation_attempts: Annotation<number>,
  grade_generation: Annotation<"useful" | "not_supported" | "not_useful">,
  hallucination_grade: Annotation<"yes" | "no">,
  answer_grade: Annotation<"yes" | "no">,
});

type AdaptiveRAGStateType = typeof AdaptiveRAGStateAnnotation.State;

/** 检索源（MCP）配置 */
interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

/** 创建 Adaptive RAG Graph 的配置 */
export interface CreateAdaptiveRAGGraphConfig extends AdaptiveRAGConfig {
  mcpServers: Record<string, MCPServerConfig>;
  appConfig?: AppConfig;
  callbacks?: {
    onToken?: (token: string) => void | Promise<void>;
    onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
  };
}

/**
 * 创建 Adaptive RAG Graph（编译后的 LangGraph 图）。
 */
export function createAdaptiveRAGGraph(config: CreateAdaptiveRAGGraphConfig) {
  const retrieveConfig: RetrieveNodeConfig = {
    mcpServers: config.mcpServers,
    retrievalTools: config.retrievalTools,
    retrieve: config.retrieve,
    onToolCall: config.callbacks?.onToolCall,
  };

  // 复用 rag 的节点（每个按 appConfig 实例化）
  const rewriteNode = createRewriteNode(config.appConfig);
  const routeQuestionNode = createRouteQuestionNode(config.appConfig);
  const transformQueryNode = createTransformQueryNode(config.appConfig);

  log.info("Creating Adaptive StateGraph", {
    nodes: [
      "rewrite",
      "route_question",
      "retrieve",
      "web_search",
      "grade_documents",
      "transform_query",
      "prepare",
      "generate",
      "grade_gen",
    ],
  });

  const graph = new StateGraph(AdaptiveRAGStateAnnotation)
    // ── 节点 ────────────────────────────────────────────
    .addNode("rewrite", async (state: AdaptiveRAGStateType) => rewriteNode(state))
    .addNode("route_question", async (state: AdaptiveRAGStateType) => routeQuestionNode(state))
    .addNode("retrieve", async (state: AdaptiveRAGStateType) => retrieveNode(state, retrieveConfig))
    .addNode("web_search", async (state: AdaptiveRAGStateType) => webSearchNode(state, config))
    .addNode("grade_documents", async (state: AdaptiveRAGStateType) =>
      gradeDocumentsNode(state, config.appConfig)
    )
    .addNode("transform_query", async (state: AdaptiveRAGStateType) => transformQueryNode(state))
    .addNode("prepare", async (state: AdaptiveRAGStateType) => prepareNode(state, config))
    .addNode("generate", async (state: AdaptiveRAGStateType) =>
      generateNode(state, config, config.appConfig, config.callbacks)
    )
    .addNode("grade_gen", async (state: AdaptiveRAGStateType) =>
      gradeGenerationNode(state, config.appConfig)
    )

    // ── 连线（含三条条件边）─────────────────────────────
    .addEdge(START, "rewrite")
    .addEdge("rewrite", "route_question")
    .addConditionalEdges("route_question", routeAfterRouteQuestion, {
      web_search: "web_search",
      vectorstore: "retrieve",
    })
    .addEdge("web_search", "prepare")
    .addEdge("retrieve", "grade_documents")
    .addConditionalEdges("grade_documents", routeAfterGradeDocuments, {
      transform_query: "transform_query",
      prepare: "prepare",
    })
    .addEdge("transform_query", "retrieve")
    .addEdge("prepare", "generate")
    .addEdge("generate", "grade_gen")
    .addConditionalEdges("grade_gen", routeAfterGradeGeneration, {
      useful: END,
      not_supported: "generate",
      not_useful: "transform_query",
    });

  log.info(
    "Adaptive graph compiled: START → rewrite → route_question →{web_search|retrieve} → grade_documents →{transform_query|prepare} → generate → grade_gen →{useful:END|not_supported:generate|not_useful:transform_query}"
  );

  return graph.compile();
}

/**
 * 执行 Adaptive RAG 查询
 */
export async function executeAdaptiveRAG(
  query: string,
  options: {
    config: CreateAdaptiveRAGGraphConfig;
    history?: BaseMessage[];
    callbacks?: {
      onToken?: (token: string) => void | Promise<void>;
      onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
    };
  }
): Promise<RAGResponse> {
  const { config, callbacks } = options;
  const graph = createAdaptiveRAGGraph({ ...config, callbacks });

  const startTime = Date.now();

  try {
    const result = await graph.invoke({
      query,
      history: options?.history || [],
    });

    return {
      answer: result.answer || "无法生成回答",
      sources: result.sources || [],
      confidence: calculateConfidence(result),
      metadata: {
        intent: result.intent,
        tools_used: result.metadata?.tools_used || [],
        token_count: result.token_count || 0,
        duration_ms: Date.now() - startTime,
        rewritten_query: result.rewritten_query,
      },
    };
  } catch (error) {
    log.error("Adaptive RAG execution failed", { error: String(error) });
    return {
      answer: "抱歉，处理您的问题时出现错误。",
      sources: [],
      metadata: {
        tools_used: [],
        token_count: 0,
        duration_ms: Date.now() - startTime,
      },
    };
  }
}

/** 计算置信度（简单启发式，与 rag/graph.ts 一致） */
function calculateConfidence(state: AdaptiveRAGStateType): number {
  let confidence = 0.5;
  if (state.context && state.context.length > 100) confidence += 0.2;
  if (state.sources && state.sources.length > 0) confidence += 0.1;
  if (state.raw_results && state.raw_results.length > 1) confidence += 0.1;
  return Math.min(confidence, 1.0);
}

export { AdaptiveRAGStateAnnotation };
export type { AdaptiveRAGStateType };
