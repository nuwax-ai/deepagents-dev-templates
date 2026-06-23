/**
 * Adaptive RAG 类型定义 —— 复用 rag 的 RAGState/RAGConfig，扩展自适应路由与生成后自纠正字段。
 *
 * 对齐官方 LangGraph Adaptive RAG（route_question / web_search / grade_documents /
 * transform_query / hallucination_grader / answer_grader）所需的状态通道。
 */
import type {
  RAGState,
  RAGConfig,
  RetrievalResult,
} from "../../rag/nodes/types.js";
import { DEFAULT_RAG_CONFIG } from "../../rag/nodes/types.js";

/**
 * Adaptive RAG 状态 —— 在 RAGState 基础上新增：
 *  - route：route_question 的路由裁决（web_search | vectorstore）
 *  - generation_attempts：generate 重试计数（防 generate↔generate 死循环）
 *  - grade_generation：生成后三路裁决（useful | not_supported | not_useful）
 *  - hallucination_grade / answer_grade：两个 grader 的原始评分（调试/可观测用）
 */
export interface AdaptiveRAGState extends RAGState {
  route?: "web_search" | "vectorstore";
  generation_attempts?: number;
  grade_generation?: "useful" | "not_supported" | "not_useful";
  hallucination_grade?: "yes" | "no";
  answer_grade?: "yes" | "no";
}

/** Adaptive RAG 配置 —— 在 RAGConfig 基础上新增 web_search 槽位。 */
export interface AdaptiveRAGConfig extends RAGConfig {
  webSearch: {
    /** web_search 每次返回的最大条目数（传给 webSearchTool）。 */
    maxResults: number;
  };
}

/**
 * 默认 Adaptive RAG 配置（复用 DEFAULT_RAG_CONFIG 的 rewrite/retrieve/prepare/agent 段）。
 *
 * 收敛上限（retrieve↔transform_query、generate↔grade_gen 循环）为硬编码常量，见
 * grade-documents.ts:MAX_RETRIEVE_ATTEMPTS / grade-generation.ts:MAX_GENERATION_ATTEMPTS
 * （刻意独立、各自可调；不暴露为 config 字段，避免"看似可配实为死配置"的误导）。
 */
export const DEFAULT_ADAPTIVE_RAG_CONFIG: AdaptiveRAGConfig = {
  ...DEFAULT_RAG_CONFIG,
  webSearch: {
    maxResults: 3,
  },
};

export type { RetrievalResult };
