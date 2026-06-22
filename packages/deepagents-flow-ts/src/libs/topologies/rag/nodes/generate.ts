/**
 * Generate 节点 - 基于检索上下文生成最终回答
 *
 * 职责：
 * 1. 基于 prepare 产出的上下文生成回答
 * 2. 支持流式输出（onToken）
 * 3. 包含来源引用
 *
 * 实现：复用 createLlmStreamNode（统一韧性 / 流式退路 / extractText，消除与 llm.ts 的重实现漂移）。
 * RAG 经 invoke 执行（非 streamMode:"custom"，无 writer），故把 onToken 接进 lgConfig.configurable，
 * 由 streamLLMText → emitTextToken 的 configurable.onToken 退路 emit。
 *
 * 说明：此前命名为 `agentNode`，为避免与 "agent loop" 概念混淆，
 * 在工作流模板中更名为 `generateNode` —— 它只是图里的一个生成节点。
 */

import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { type AppConfig } from "../../../../runtime/index.js";
import { resolveLlmResilience } from "../../../../runtime/services/llm-resilience.js";
import { createLlmStreamNode, requireModel } from "../../../nodes/index.js";
import type { RAGState, RAGConfig, RAGMetadata } from "./types.js";

const GENERATE_SYSTEM_PROMPT = `你是一个专业的知识助手。基于提供的上下文信息回答用户的问题。

规则：
1. 只基于提供的上下文回答，不要编造信息
2. 如果上下文不足以回答，明确说明
3. 引用来源时使用 [来源X] 格式
4. 回答要准确、简洁、有条理
5. 如果是操作指南类问题，提供清晰的步骤`;

/** 构造 generate 的消息列表：系统提示 + 上下文/来源 + 最近历史 + 用户问题。 */
function buildGenerateMessages(state: RAGState, config: RAGConfig): BaseMessage[] {
  const { context, sources, rewritten_query, history } = state;
  const query = rewritten_query || state.query;

  let userPrompt = "";
  if (context) {
    userPrompt += `## 上下文信息\n\n${context}\n\n`;
    if (sources && sources.length > 0 && config.agent.includeSources) {
      userPrompt += `## 来源\n\n`;
      sources.forEach((s, i) => {
        userPrompt += `[来源${i + 1}] ${s.title}${s.url ? ` (${s.url})` : ""}\n`;
      });
      userPrompt += "\n";
    }
  } else {
    userPrompt += `## 上下文信息\n\n未找到相关上下文。\n\n`;
  }
  userPrompt += `## 用户问题\n\n${query}`;

  const messages: BaseMessage[] = [new SystemMessage(GENERATE_SYSTEM_PROMPT)];
  if (history && history.length > 0) {
    messages.push(...history.slice(-6));
  }
  messages.push(new HumanMessage(userPrompt));
  return messages;
}

/**
 * Generate 节点：基于检索上下文生成回答（复用 createLlmStreamNode）。
 * 无凭证 → requireModel 抛清晰错误（在 createLlmStreamNode 的 try 外，由 executeRAG 顶层 catch 兜底）；
 * 调用失败 → 下方 fallback 降级为可读错误提示。
 */
export async function generateNode(
  state: RAGState,
  config: RAGConfig,
  appConfig?: AppConfig,
  callbacks?: {
    onToken?: (token: string) => void | Promise<void>;
  }
): Promise<Partial<RAGState>> {
  const startTime = Date.now();
  const node = createLlmStreamNode<RAGState>({
    model: () => requireModel(appConfig, "RAG generate"),
    prompt: (s) => buildGenerateMessages(s, config),
    write: ({ text }, s) => ({ answer: text, metadata: buildMetadata(s, startTime) }),
    config: appConfig,
    label: "rag generate",
    timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    fallback: (s) => ({
      answer: "抱歉，生成回答时出现错误。请稍后重试。",
      metadata: {
        tools_used: [],
        token_count: s.token_count || 0,
        duration_ms: Date.now() - startTime,
      },
    }),
  });
  // RAG 经 invoke 执行（非 streamMode:"custom"，无 writer），把 onToken 接进 configurable，
  // 由 streamLLMText → emitTextToken 的 configurable.onToken 退路 emit。
  const lgConfig: LangGraphRunnableConfig | undefined =
    config.agent.streaming && callbacks?.onToken
      ? { configurable: { onToken: callbacks.onToken } }
      : undefined;
  return node(state, lgConfig);
}

function buildMetadata(state: RAGState, startTime: number): RAGMetadata {
  return {
    intent: state.intent,
    tools_used: state.raw_results?.map((r) => r.tool).filter(Boolean) || [],
    token_count: state.token_count || 0,
    duration_ms: Date.now() - startTime,
    rewritten_query: state.rewritten_query,
  };
}
