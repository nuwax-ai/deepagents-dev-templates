/**
 * Prepare 节点 - 结果准备
 *
 * 职责：
 * 1. 合并多个 MCP 工具返回的结果
 * 2. 去重 + 按相关性排序
 * 3. 截断/摘要过长内容（控制 token）
 * 4. 格式标准化
 */

import type { RAGState, RAGConfig, Source, RetrievalResult } from "./types.js";

export async function prepareNode(
  state: RAGState,
  config: RAGConfig
): Promise<Partial<RAGState>> {
  const { raw_results } = state;

  if (!raw_results || raw_results.length === 0) {
    return {
      context: "",
      sources: [],
      token_count: 0,
    };
  }

  try {
    // 1. 合并结果
    const merged = mergeResults(raw_results);

    // 2. 去重
    const deduplicated = config.prepare.deduplication
      ? deduplicateResults(merged)
      : merged;

    // 3. 排序（按相关性/分数）
    const sorted = config.prepare.sortByRelevance
      ? sortByRelevance(deduplicated)
      : deduplicated;

    // 4. 截断到 token 限制
    const { content, sources, tokenCount } = truncateToTokenLimit(
      sorted,
      config.prepare.maxContextTokens
    );

    return {
      context: content,
      sources,
      token_count: tokenCount,
    };
  } catch (error) {
    console.error("[Prepare] Error:", error);
    return {
      context: "",
      sources: [],
      token_count: 0,
    };
  }
}

/**
 * 合并多个工具的结果
 */
function mergeResults(results: RetrievalResult[]): MergedResult[] {
  const merged: MergedResult[] = [];

  for (const result of results) {
    // 解析内容（假设内容可能是 JSON 或纯文本）
    const items = parseContent(result.content, result.tool);
    merged.push(...items);
  }

  return merged;
}

interface MergedResult {
  content: string;
  source: string;
  tool: string;
  score?: number;
}

/**
 * 解析工具返回的内容
 */
function parseContent(content: string, tool: string): MergedResult[] {
  try {
    // 尝试解析 JSON
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        content: typeof item === "string" ? item : JSON.stringify(item),
        source: item.source || item.url || tool,
        tool,
        score: item.score || item.relevance,
      }));
    }
    return [
      {
        content: typeof parsed === "string" ? parsed : JSON.stringify(parsed),
        source: parsed.source || tool,
        tool,
        score: parsed.score,
      },
    ];
  } catch {
    // 纯文本，按段落分割
    const paragraphs = content.split(/\n\n+/).filter((p) => p.trim());
    return paragraphs.map((p) => ({
      content: p.trim(),
      source: tool,
      tool,
    }));
  }
}

/**
 * 去重
 */
function deduplicateResults(results: MergedResult[]): MergedResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    // 使用内容的前 100 字符作为去重 key
    const key = r.content.substring(0, 100).toLowerCase().trim();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 按相关性排序
 */
function sortByRelevance(results: MergedResult[]): MergedResult[] {
  return [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * 截断到 token 限制
 * 简单估算：1 token ≈ 4 字符（英文）或 1.5 字符（中文）
 */
function truncateToTokenLimit(
  results: MergedResult[],
  maxTokens: number
): { content: string; sources: Source[]; tokenCount: number } {
  const sources: Source[] = [];
  let content = "";
  let currentTokens = 0;

  for (const result of results) {
    const estimatedTokens = estimateTokens(result.content);

    if (currentTokens + estimatedTokens > maxTokens) {
      // 截断当前内容
      const remainingTokens = maxTokens - currentTokens;
      const truncated = truncateText(
        result.content,
        remainingTokens * 4
      ); // 粗略估算字符数

      if (truncated) {
        content += "\n\n" + truncated;
        sources.push({
          title: result.source,
          snippet: truncated.substring(0, 200) + "...",
        });
      }
      break;
    }

    content += (content ? "\n\n" : "") + result.content;
    sources.push({
      title: result.source,
      snippet: result.content.substring(0, 200) + "...",
    });
    currentTokens += estimatedTokens;
  }

  return {
    content: content.trim(),
    sources,
    tokenCount: currentTokens,
  };
}

/**
 * 估算 token 数
 */
function estimateTokens(text: string): number {
  // 简单估算：中文约 1.5 字符/token，英文约 4 字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 截断文本
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // 尝试在句号处截断
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf("。");
  const lastDot = truncated.lastIndexOf(".");

  const cutPoint = Math.max(lastPeriod, lastDot);
  if (cutPoint > maxLength * 0.8) {
    return truncated.substring(0, cutPoint + 1);
  }

  return truncated + "...";
}
