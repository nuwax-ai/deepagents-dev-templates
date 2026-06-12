/**
 * Generate 节点 - 基于检索上下文生成最终回答
 *
 * 职责：
 * 1. 基于 prepare 产出的上下文生成回答
 * 2. 支持流式输出（onToken）
 * 3. 包含来源引用
 *
 * 说明：此前命名为 `agentNode`，为避免与 "agent loop" 概念混淆，
 * 在工作流模板中更名为 `generateNode` —— 它只是图里的一个生成节点。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { resolveModel, type AppConfig } from "deepagents-app-ts/runtime";
import type { RAGState, RAGConfig, RAGMetadata } from "./types.js";

const GENERATE_SYSTEM_PROMPT = `你是一个专业的知识助手。基于提供的上下文信息回答用户的问题。

规则：
1. 只基于提供的上下文回答，不要编造信息
2. 如果上下文不足以回答，明确说明
3. 引用来源时使用 [来源X] 格式
4. 回答要准确、简洁、有条理
5. 如果是操作指南类问题，提供清晰的步骤`;

export async function generateNode(
  state: RAGState,
  config: RAGConfig,
  appConfig?: AppConfig,
  callbacks?: {
    onToken?: (token: string) => void | Promise<void>;
  }
): Promise<Partial<RAGState>> {
  const { context, sources, rewritten_query } = state;
  const { history } = state;
  const query = rewritten_query || state.query;
  const startTime = Date.now();

  try {
    // 使用配置中的模型；resolveModel 类型上含 string/undefined，RAG 节点需要实例
    const model = resolveModel(appConfig!);
    if (!model || typeof model === "string") {
      throw new Error("RAG generate node requires an instantiated chat model");
    }

    // 构建用户提示
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

    // 构建消息列表
    const messages: any[] = [new SystemMessage(GENERATE_SYSTEM_PROMPT)];

    // 添加历史对话
    if (history && history.length > 0) {
      const recentHistory = history.slice(-6);
      messages.push(...recentHistory);
    }

    messages.push(new HumanMessage(userPrompt));

    // 调用模型
    if (config.agent.streaming && callbacks?.onToken) {
      // 流式输出
      let answer = "";
      const stream = await model.stream(messages);

      for await (const chunk of stream) {
        const content = chunk.content;
        if (typeof content === "string") {
          answer += content;
          await callbacks.onToken(content);
        }
      }

      return {
        answer,
        metadata: buildMetadata(state, startTime),
      };
    } else {
      // 非流式
      const response = await model.invoke(messages);
      const answer =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      return {
        answer,
        metadata: buildMetadata(state, startTime),
      };
    }
  } catch (error) {
    console.error("[Generate] Error:", error);
    return {
      answer: "抱歉，生成回答时出现错误。请稍后重试。",
      metadata: {
        tools_used: [],
        token_count: state.token_count || 0,
        duration_ms: Date.now() - startTime,
      },
    };
  }
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
