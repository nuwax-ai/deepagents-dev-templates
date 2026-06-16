/**
 * Context7 文档检索 —— deep-research 示例专用（自包含 stdio MCP，不依赖 FlowRuntime）。
 *
 * 流程：resolve-library-id → query-docs（与 examples/rag 同语义，逻辑复制在本文件）。
 */

import { logger } from "../../../../src/runtime/index.js";
import { callResolvedMcpTool, type McpServerConfig } from "../../../mcp-client.js";

const log = logger.child("deep-research-context7");

/** Context7 MCP 超时（毫秒）。 */
export const CONTEXT7_TIMEOUT_MS = 15000;

/** 与 config/mcp.default.json 一致。 */
export const CONTEXT7_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "@upstash/context7-mcp"],
};

/**
 * 从 resolve-library-id 返回文本解析 library ID（取 Benchmark Score 最高）。
 * 示例格式：`Context7-compatible library ID: /langchain-ai/langgraph`
 */
export function extractBestLibraryId(text: string): string | null {
  const blockPattern =
    /Context7-compatible library ID:\s*(\S+)[\s\S]*?Benchmark Score:\s*([\d.]+)/g;
  let best: { id: string; score: number } | null = null;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const id = match[1]!;
    const score = parseFloat(match[2]!);
    if (!best || score > best.score) {
      best = { id, score };
    }
  }
  if (best) return best.id;

  const fallback = text.match(/Context7-compatible library ID:\s*(\S+)/);
  return fallback?.[1] ?? null;
}

export interface Context7SearchResult {
  text: string;
  ok: boolean;
  libraryId?: string;
}

/**
 * 调 Context7 MCP 查文档；失败不抛错，返回可读降级文本。
 */
export async function invokeContext7Search(
  query: string,
  libraryHint?: string
): Promise<Context7SearchResult> {
  const libraryName = (libraryHint ?? query.split(/\s+/)[0] ?? query).trim();
  try {
    const resolveText = await callResolvedMcpTool(
      CONTEXT7_MCP,
      "resolve-library-id",
      { libraryName, query },
      {
        timeoutMs: CONTEXT7_TIMEOUT_MS,
        aliases: ["resolve_library_id"],
      }
    );
    const libraryId = extractBestLibraryId(resolveText);
    if (!libraryId) {
      const trimmed = resolveText.trim();
      if (!trimmed) {
        return { text: `（Context7 未解析到库：${libraryName}）`, ok: false };
      }
      log.warn("Context7 resolve 无 libraryId → 用 resolve 原文降级", {
        query,
        snippet: trimmed.slice(0, 80),
      });
      return { text: trimmed.slice(0, 1200), ok: trimmed.length > 80 };
    }

    const docsText = await callResolvedMcpTool(
      CONTEXT7_MCP,
      "query-docs",
      { libraryId, query },
      {
        timeoutMs: CONTEXT7_TIMEOUT_MS,
        aliases: ["query_docs"],
      }
    );
    const trimmed = docsText.trim();
    if (!trimmed) {
      return {
        text: `（Context7 无文档：${libraryId}）`,
        ok: false,
        libraryId,
      };
    }
    return { text: trimmed.slice(0, 1200), ok: true, libraryId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("Context7 检索失败 → 降级", { query, error: message });
    return {
      text: `（Context7 检索失败：${message}）`,
      ok: false,
    };
  }
}
