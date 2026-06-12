/**
 * RAG Workflow Graph — 显式 LangGraph StateGraph
 *
 * 这是本模板的主角：Agent 不是"自由 tool loop"，而是按设计好的
 * 节点连线规则运行的工作流图。
 *
 *   START → rewrite → retrieve → grade ─(条件边)─┐
 *                          ▲                      ├─ insufficient & 未达上限 → rewrite（重试）
 *                          └──────────────────────┘
 *                                       └─ 否则 → prepare → generate → END
 *
 * 想改编排？改下面的 addNode / addEdge / addConditionalEdges 即可——
 * 节点与连线都是静态可读、可被 inspector 抽取/可视化的结构。
 */

import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import { rewriteNode } from "./nodes/rewrite.js";
import { retrieveNode, type RetrieveNodeConfig } from "./nodes/retrieve.js";
import { gradeNode, routeAfterGrade } from "./nodes/grade.js";
import { prepareNode } from "./nodes/prepare.js";
import { generateNode } from "./nodes/generate.js";
import type {
  RAGConfig,
  RAGMetadata,
  RAGResponse,
  RetrievalResult,
  Source,
} from "./nodes/types.js";

import type { ToolCallEvent } from "../../src/surfaces/flow-types.js";

// ACP stdio 模式下 stdout 是协议通道，日志必须走 logger（stderr）
const log = logger.child("rag-graph");

/** RAG State 定义（图的 channels） */
const RAGStateAnnotation = Annotation.Root({
  // 输入
  query: Annotation<string>,
  history: Annotation<BaseMessage[]>,

  // Rewrite 输出
  rewritten_query: Annotation<string>,
  intent: Annotation<string>,
  keywords: Annotation<string[]>,
  mcp_hint: Annotation<string>,

  // Retrieve 输出
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
});

type RAGStateType = typeof RAGStateAnnotation.State;

/** 检索源（MCP）配置 */
interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

/** 创建 RAG Graph 的配置 */
export interface CreateRAGGraphConfig extends RAGConfig {
  mcpServers: Record<string, MCPServerConfig>;
  appConfig?: AppConfig;
  callbacks?: {
    onToken?: (token: string) => void | Promise<void>;
    onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
  };
}

/**
 * 创建 RAG Graph（编译后的 LangGraph 图）
 */
export function createRAGGraph(config: CreateRAGGraphConfig) {
  const retrieveConfig: RetrieveNodeConfig = {
    mcpServers: config.mcpServers,
    retrievalTools: config.retrievalTools,
    retrieve: config.retrieve,
    onToolCall: config.callbacks?.onToolCall,
  };

  log.info("Creating StateGraph", {
    nodes: ["rewrite", "retrieve", "grade", "prepare", "generate"],
  });

  const graph = new StateGraph(RAGStateAnnotation)
    // ── 节点 ────────────────────────────────────────────
    .addNode("rewrite", async (state: RAGStateType) => {
      const result = await rewriteNode(state, config.appConfig);
      log.info("node rewrite done", { intent: result.intent });
      return result;
    })
    .addNode("retrieve", async (state: RAGStateType) => {
      const result = await retrieveNode(state, retrieveConfig);
      log.info("node retrieve done", {
        resultCount: result.raw_results?.length,
        attempts: result.attempts,
      });
      return result;
    })
    // 节点名 "grade_docs" 不能与 state channel "grade" 同名（LangGraph 限制）
    .addNode("grade_docs", (state: RAGStateType) => gradeNode(state))
    .addNode("prepare", async (state: RAGStateType) => {
      const result = await prepareNode(state, config);
      log.info("node prepare done", { tokenCount: result.token_count });
      return result;
    })
    .addNode("generate", async (state: RAGStateType) => {
      const result = await generateNode(state, config, config.appConfig, config.callbacks);
      log.info("node generate done", { answerLength: result.answer?.length });
      return result;
    })

    // ── 连线（含条件边）─────────────────────────────────
    .addEdge(START, "rewrite")
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "grade_docs")
    .addConditionalEdges("grade_docs", routeAfterGrade, {
      rewrite: "rewrite",
      prepare: "prepare",
    })
    .addEdge("prepare", "generate")
    .addEdge("generate", END);

  log.info(
    "Graph compiled: START → rewrite → retrieve → grade_docs →(cond) rewrite|prepare → generate → END"
  );

  return graph.compile();
}

/**
 * 执行 RAG 查询
 */
export async function executeRAG(
  query: string,
  options: {
    config: CreateRAGGraphConfig;
    history?: BaseMessage[];
    callbacks?: {
      onToken?: (token: string) => void | Promise<void>;
      onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
    };
  }
): Promise<RAGResponse> {
  const { config, callbacks } = options;
  const graph = createRAGGraph({ ...config, callbacks });

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
    log.error("RAG execution failed", { error: String(error) });
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

/**
 * 计算置信度（简单启发式）
 */
function calculateConfidence(state: RAGStateType): number {
  let confidence = 0.5; // 基础置信度

  if (state.context && state.context.length > 100) {
    confidence += 0.2;
  }
  if (state.sources && state.sources.length > 0) {
    confidence += 0.1;
  }
  if (state.raw_results && state.raw_results.length > 1) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

export { RAGStateAnnotation };
export type { RAGStateType };
