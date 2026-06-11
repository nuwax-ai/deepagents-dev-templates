/**
 * RAG Agent Graph - LangGraph StateGraph 定义
 *
 * 流程：Query → Rewrite → Retrieve → Prepare → Agent → Response
 */

import { StateGraph, END, START } from "@langchain/langgraph";
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { rewriteNode } from "./nodes/rewrite.js";
import { retrieveNode, type RetrieveNodeConfig } from "./nodes/retrieve.js";
import { prepareNode } from "./nodes/prepare.js";
import { agentNode } from "./nodes/agent.js";
import type {
  RAGConfig,
  RAGResponse,
  RetrievalResult,
  Source,
} from "./nodes/types.js";
import { DEFAULT_RAG_CONFIG } from "./nodes/types.js";
import type { AppConfig } from "../runtime/config/config-loader.js";

/** RAG State 定义 */
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

  // Prepare 输出
  context: Annotation<string>,
  sources: Annotation<Source[]>,
  token_count: Annotation<number>,

  // Agent 输出
  answer: Annotation<string>,

  // 元数据
  metadata: Annotation<Record<string, any>>,
});

type RAGStateType = typeof RAGStateAnnotation.State;

/** MCP 服务器配置 */
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
}

/**
 * 创建 RAG Graph
 */
export function createRAGGraph(config: CreateRAGGraphConfig) {
  // 构建 Retrieve 节点配置
  const retrieveConfig: RetrieveNodeConfig = {
    mcpServers: config.mcpServers,
    retrievalTools: config.retrievalTools,
    retrieve: config.retrieve,
  };

  const graph = new StateGraph(RAGStateAnnotation)
    // 添加节点
    .addNode("rewrite", async (state: RAGStateType) => {
      return await rewriteNode(state, config.appConfig);
    })
    .addNode("retrieve", async (state: RAGStateType) => {
      return await retrieveNode(state, retrieveConfig);
    })
    .addNode("prepare", async (state: RAGStateType) => {
      return await prepareNode(state, config);
    })
    .addNode("agent", async (state: RAGStateType) => {
      return await agentNode(state, config, config.appConfig);
    })

    // 定义边
    .addEdge(START, "rewrite")
    .addEdge("rewrite", "retrieve")
    .addEdge("retrieve", "prepare")
    .addEdge("prepare", "agent")
    .addEdge("agent", END);

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
      onToken?: (token: string) => void;
    };
  }
): Promise<RAGResponse> {
  const { config } = options;
  const graph = createRAGGraph(config);

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
    console.error("[RAG Graph] Error:", error);
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
 * 计算置信度
 */
function calculateConfidence(state: RAGStateType): number {
  let confidence = 0.5; // 基础置信度

  // 有上下文提高置信度
  if (state.context && state.context.length > 100) {
    confidence += 0.2;
  }

  // 有来源提高置信度
  if (state.sources && state.sources.length > 0) {
    confidence += 0.1;
  }

  // 多个工具结果提高置信度
  if (state.raw_results && state.raw_results.length > 1) {
    confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

export { RAGStateAnnotation };
export type { RAGStateType };
