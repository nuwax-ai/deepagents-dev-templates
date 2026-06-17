/**
 * Rewrite 节点 - 意图识别 + 查询重写
 *
 * 职责：
 * 1. 分析用户意图（factual/how_to/comparison/latest/explain）
 * 2. 重写查询使其更适合检索
 * 3. 提取关键词
 * 4. 推荐检索源（mcp_hint）
 *
 * 实现：框架 createLlmNode（parse JSON + fallback 降级）。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { resolveModel, type AppConfig } from "../../../src/runtime/index.js";
import { resolveLlmResilience } from "../../../src/runtime/services/llm-resilience.js";
import { createLlmNode, parseJson } from "../../../src/libs/nodes/index.js";
import type { RAGState, RAGIntent } from "./types.js";

const REWRITE_SYSTEM_PROMPT = `你是一个查询分析专家。你的任务是分析用户的问题，并提供结构化的分析结果。

请返回 JSON 格式：
{
  "rewritten_query": "重写后的查询，更适合搜索引擎检索",
  "intent": "意图类型，只能是: factual, how_to, comparison, latest, explain",
  "keywords": ["关键词1", "关键词2", ...],
  "mcp_hint": "建议使用的检索源名称（见下方列表）"
}

可用检索源：
- context7：技术文档库，适合查询编程语言、开源框架（React/LangGraph/Python等）、API、SDK 的用法、文档、版本信息
- howtocook-mcp：中文菜谱库，适合查询食物做法、食材、烹饪步骤

mcp_hint 规则：
- 问题涉及烹饪、食谱、菜肴 → 设为 "howtocook-mcp"
- 问题涉及技术框架、编程库、代码用法 → 设为 "context7"
- 无法判断时 → 省略 mcp_hint 字段

其他规则：
- rewritten_query 应该更具体、更完整，包含更多上下文
- keywords 提取 3-5 个核心关键词
- intent 根据问题性质判断`;

function validateIntent(intent: string): RAGIntent {
  const validIntents: RAGIntent[] = [
    "factual",
    "how_to",
    "comparison",
    "latest",
    "explain",
  ];
  return validIntents.includes(intent as RAGIntent)
    ? (intent as RAGIntent)
    : "factual";
}

function fallbackRewrite(query: string): Partial<RAGState> {
  return {
    rewritten_query: query,
    intent: "factual",
    keywords: query
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 5),
    mcp_hint: undefined,
  };
}

/** rewrite 节点：框架 createLlmNode（parse JSON 结构化输出 + 无模型/异常 fallback 降级）。 */
export function createRewriteNode(appConfig?: AppConfig) {
  return createLlmNode<RAGState>({
    // 模型缺失返回 null（触发 fallback），与原 try/catch 降级同义。
    model: () => {
      const m = resolveModel(appConfig!);
      return m && typeof m !== "string" ? m : null;
    },
    prompt: (s) => {
      let context = "";
      if (s.history && s.history.length > 0) {
        const recentHistory = s.history.slice(-6); // 最近 3 轮对话
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        context = recentHistory.map((msg: any) => `${msg._getType()}: ${msg.content}`).join("\n");
      }
      const userPrompt = context
        ? `对话历史：\n${context}\n\n当前问题：${s.query}`
        : `问题：${s.query}`;
      return [new SystemMessage(REWRITE_SYSTEM_PROMPT), new HumanMessage(userPrompt)];
    },
    parse: (text) =>
      parseJson<{ rewritten_query?: string; intent?: string; keywords?: string[]; mcp_hint?: string }>(text),
    write: (r, s) => {
      const result = (r.parsed ?? {}) as {
        rewritten_query?: string;
        intent?: string;
        keywords?: string[];
        mcp_hint?: string;
      };
      return {
        rewritten_query: result.rewritten_query || s.query,
        intent: validateIntent(result.intent ?? "factual"),
        keywords: result.keywords || [],
        mcp_hint: result.mcp_hint || undefined,
      };
    },
    fallback: (s) => fallbackRewrite(s.query),
    config: appConfig,
    label: "rag rewrite",
    timeoutMs: resolveLlmResilience(appConfig).shortTimeoutMs,
  });
}
