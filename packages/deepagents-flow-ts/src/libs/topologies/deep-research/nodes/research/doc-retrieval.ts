/**
 * 文档库 MCP 检索 —— deep-research 示例（须平台登记后注入，不硬编码 server 包）。
 *
 * 流程：resolve-library-id → query-docs（与常见文档 MCP 语义一致）。
 */

import { logger } from "../../../../../runtime/index.js";
import { callResolvedMcpTool, type McpServerConfig } from "../../../../mcp/mcp-access.js";

const log = logger.child("deep-research-doc");

/** 文档检索 MCP 超时（毫秒）。 */
export const DOC_RETRIEVAL_TIMEOUT_MS = 15000;

/** 平台登记并注入的文档检索 MCP（如文档库 Plugin 映射的 stdio server）。 */
export interface DocRetrievalMcp {
  config: McpServerConfig;
  /** resolve 工具名（默认 resolve-library-id）。 */
  resolveTool?: string;
  /** query 工具名（默认 query-docs）。 */
  queryTool?: string;
}

/**
 * 从 resolve-library-id 类工具返回文本解析 library ID（取 Benchmark Score 最高）。
 */
export function extractBestLibraryId(text: string): string | null {
  const blockPattern =
    /(?:library ID|Library ID):\s*(\S+)[\s\S]*?(?:Benchmark Score|score):\s*([\d.]+)/gi;
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

  const labeled = text.match(/(?:library ID|Library ID):\s*(\S+)/i);
  if (labeled?.[1]) return labeled[1];

  const pathLike = text.match(/^\s*(\/[\w.-]+\/[\w.-]+)/m);
  return pathLike?.[1] ?? null;
}

export interface DocRetrievalResult {
  text: string;
  ok: boolean;
  libraryId?: string;
}

/**
 * 调平台登记的文档 MCP；未配置 docMcp 或失败时不抛错，返回可读降级文本。
 */
export async function invokeDocRetrieval(
  docMcp: DocRetrievalMcp | undefined,
  query: string,
  libraryHint?: string
): Promise<DocRetrievalResult> {
  if (!docMcp) {
    return {
      text: "（未配置文档检索 MCP：须经平台登记后在 recipe 传入 docMcp）",
      ok: false,
    };
  }

  const resolveTool = docMcp.resolveTool ?? "resolve-library-id";
  const queryTool = docMcp.queryTool ?? "query-docs";
  const libraryName = (libraryHint ?? query.split(/\s+/)[0] ?? query).trim();

  try {
    const resolveText = await callResolvedMcpTool(
      docMcp.config,
      resolveTool,
      { libraryName, query },
      {
        timeoutMs: DOC_RETRIEVAL_TIMEOUT_MS,
        aliases: ["resolve_library_id"],
      }
    );
    const libraryId = extractBestLibraryId(resolveText);
    if (!libraryId) {
      const trimmed = resolveText.trim();
      if (!trimmed) {
        return { text: `（文档 MCP 未解析到库：${libraryName}）`, ok: false };
      }
      log.warn("resolve 无 libraryId → 用原文降级", {
        query,
        snippet: trimmed.slice(0, 80),
      });
      return { text: trimmed.slice(0, 1200), ok: trimmed.length > 80 };
    }

    const docsText = await callResolvedMcpTool(
      docMcp.config,
      queryTool,
      { libraryId, query },
      {
        timeoutMs: DOC_RETRIEVAL_TIMEOUT_MS,
        aliases: ["query_docs"],
      }
    );
    const trimmed = docsText.trim();
    if (!trimmed) {
      return {
        text: `（文档 MCP 无内容：${libraryId}）`,
        ok: false,
        libraryId,
      };
    }
    return { text: trimmed.slice(0, 1200), ok: true, libraryId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("文档 MCP 检索失败 → 降级", { query, error: message });
    return {
      text: `（文档检索失败：${message}）`,
      ok: false,
    };
  }
}
