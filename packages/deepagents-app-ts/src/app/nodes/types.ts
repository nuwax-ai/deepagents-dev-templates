/**
 * RAG Agent 类型定义
 */

import { BaseMessage } from "@langchain/core/messages";

/** 来源信息 */
export interface Source {
  title: string;
  url?: string;
  snippet: string;
  score?: number;
}

/** RAG 状态 - 贯穿整个流程 */
export interface RAGState {
  // 输入
  query: string;
  history?: BaseMessage[];

  // Rewrite 输出
  rewritten_query?: string;
  intent?: string;  // RAGIntent 类型在 Annotation 中用 string
  keywords?: string[];
  mcp_hint?: string;

  // Retrieve 输出
  raw_results?: RetrievalResult[];

  // Prepare 输出
  context?: string;
  sources?: Source[];
  token_count?: number;

  // Agent 输出
  answer?: string;

  // 元数据
  metadata?: RAGMetadata;
}

/** 意图类型 */
export type RAGIntent =
  | "factual"     // 事实查询
  | "how_to"      // 操作指南
  | "comparison"  // 对比分析
  | "latest"      // 最新信息
  | "explain";    // 概念解释

/** MCP 工具检索结果 */
export interface RetrievalResult {
  tool: string;
  content: string;
  metadata?: Record<string, any>;
}

/** RAG 响应 */
export interface RAGResponse {
  answer: string;
  sources: Source[];
  confidence?: number;
  metadata: RAGMetadata;
}

/** 元数据 */
export interface RAGMetadata {
  intent?: string;
  tools_used: string[];
  token_count: number;
  duration_ms: number;
  rewritten_query?: string;
}

/** RAG 配置 */
export interface RAGConfig {
  enabled: boolean;
  retrievalTools: string[];
  rewrite: {
    maxKeywords: number;
    intentCategories: RAGIntent[];
  };
  retrieve: {
    maxResults: number;
    timeout_ms: number;
    retryCount: number;
  };
  prepare: {
    maxContextTokens: number;
    deduplication: boolean;
    sortByRelevance: boolean;
  };
  agent: {
    streaming: boolean;
    includeSources: boolean;
    confidenceThreshold: number;
  };
}

/** 默认 RAG 配置 */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  enabled: true,
  retrievalTools: [],
  rewrite: {
    maxKeywords: 5,
    intentCategories: ["factual", "how_to", "comparison", "latest", "explain"],
  },
  retrieve: {
    maxResults: 10,
    timeout_ms: 5000,
    retryCount: 1,
  },
  prepare: {
    maxContextTokens: 4000,
    deduplication: true,
    sortByRelevance: true,
  },
  agent: {
    streaming: true,
    includeSources: true,
    confidenceThreshold: 0.5,
  },
};
