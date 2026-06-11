/**
 * Rewrite 节点 - 意图识别 + 查询重写
 *
 * 职责：
 * 1. 分析用户意图（factual/how_to/comparison/latest/explain）
 * 2. 重写查询使其更适合检索
 * 3. 提取关键词
 * 4. 推荐 MCP 工具
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RAGState, RAGIntent } from "./types.js";
import type { AppConfig } from "../../runtime/config/config-loader.js";
import { resolveModel } from "../../runtime/model.js";

const REWRITE_SYSTEM_PROMPT = `你是一个查询分析专家。你的任务是分析用户的问题，并提供结构化的分析结果。

请返回 JSON 格式：
{
  "rewritten_query": "重写后的查询，更适合搜索引擎检索",
  "intent": "意图类型，只能是: factual, how_to, comparison, latest, explain",
  "keywords": ["关键词1", "关键词2", ...],
  "mcp_hint": "建议使用的 MCP 工具名称（如果能判断）"
}

规则：
- rewritten_query 应该更具体、更完整，包含更多上下文
- keywords 提取 3-5 个核心关键词
- intent 根据问题性质判断
- mcp_hint 根据问题类型推荐工具（如需要实时信息推荐搜索工具，需要专业知识推荐知识库工具）`;

export async function rewriteNode(
  state: RAGState,
  config?: AppConfig
): Promise<Partial<RAGState>> {
  const { query, history } = state;

  try {
    // 使用配置中的模型
    const model = resolveModel(config!);

    // 构建上下文
    let context = "";
    if (history && history.length > 0) {
      const recentHistory = history.slice(-6); // 最近 3 轮对话
      context = recentHistory
        .map((msg: any) => `${msg._getType()}: ${msg.content}`)
        .join("\n");
    }

    const userPrompt = context
      ? `对话历史：\n${context}\n\n当前问题：${query}`
      : `问题：${query}`;

    const response = await model.invoke([
      new SystemMessage(REWRITE_SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ]);

    // 解析响应
    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        rewritten_query: result.rewritten_query || query,
        intent: validateIntent(result.intent),
        keywords: result.keywords || [],
        mcp_hint: result.mcp_hint || undefined,
      };
    }

    // 解析失败，降级处理
    return fallbackRewrite(query);
  } catch (error) {
    console.error("[Rewrite] Error:", error);
    // 失败降级：用原始 query
    return fallbackRewrite(query);
  }
}

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
