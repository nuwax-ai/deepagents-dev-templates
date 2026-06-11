/**
 * RAG Query Tool
 *
 * 暴露 RAG 功能给 Agent 使用
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { executeRAG, type CreateRAGGraphConfig } from "../graph.js";
import { DEFAULT_RAG_CONFIG } from "../nodes/types.js";

/**
 * 创建 RAG 查询工具
 */
export function createRAGTool(mcpServers: Record<string, any>) {
  const config: CreateRAGGraphConfig = {
    ...DEFAULT_RAG_CONFIG,
    mcpServers,
    retrievalTools: Object.keys(mcpServers),
  };

  return tool(
    async ({ query }) => {
      console.log(`[RAG Tool] Processing query: ${query}`);

      try {
        const response = await executeRAG(query, { config });

        // 格式化输出
        let output = `## 回答\n\n${response.answer}\n\n`;

        if (response.sources && response.sources.length > 0) {
          output += `## 来源\n\n`;
          response.sources.forEach((s, i) => {
            output += `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n`;
            if (s.snippet) {
              output += `   > ${s.snippet.substring(0, 100)}...\n`;
            }
          });
          output += "\n";
        }

        output += `## 元数据\n`;
        output += `- 意图: ${response.metadata.intent || "未知"}\n`;
        output += `- 使用工具: ${response.metadata.tools_used.join(", ") || "无"}\n`;
        output += `- 耗时: ${response.metadata.duration_ms}ms\n`;
        output += `- 置信度: ${((response.confidence || 0) * 100).toFixed(0)}%\n`;

        return output;
      } catch (error) {
        console.error("[RAG Tool] Error:", error);
        return `RAG 查询失败: ${error instanceof Error ? error.message : "未知错误"}`;
      }
    },
    {
      name: "rag_query",
      description: `RAG (检索增强生成) 查询工具。

使用此工具可以：
1. 分析用户问题的意图
2. 从知识库和搜索引擎检索相关信息
3. 基于检索结果生成有来源引用的回答

适用场景：
- 需要查找文档或知识库内容
- 需要最新信息
- 需要综合多个来源的回答

输入：用户的问题（自然语言）`,
      schema: z.object({
        query: z.string().describe("用户的问题"),
      }),
    }
  );
}
