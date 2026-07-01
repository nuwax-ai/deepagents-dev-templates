/**
 * Retrieve 节点 - MCP 工具调度
 *
 * 职责：
 * 1. 根据意图 + mcp_hint 决策调用哪些 MCP 工具
 * 2. 并行调用多个工具
 * 3. 收集原始结果
 *
 * MCP 调用走 libs/mcp/mcp-access（基于 @langchain/mcp-adapters）：
 * 优先级 toolInvoker（agent 已加载工具回调）> 注入 mcpClient（持久，复用连接）>
 * 自管临时 client（createAccessorFromConfig，多 transport，用完 close）。不再自管 spawn→kill。
 *
 * 文档类 MCP（resolve-library-id + query-docs）按工具能力探测，不硬编码 server 名。
 */

import { randomUUID } from "node:crypto";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { RAGState, RetrievalResult } from "./types.js";
import { logger } from "../../../../runtime/index.js";
import type { ToolCallEvent } from "../../../../core/flow-types.js";
import {
  resolveAccessor,
  type McpAccessor,
  type McpServerConfig,
} from "../../../mcp/mcp-access.js";

// ACP stdio 模式下 stdout 是协议通道，日志必须走 logger（stderr）
const log = logger.child("rag-retrieve");

/** RAG retrieve 专用 server 配置：mcp-access 多 transport 配置 + 启用开关。 */
type RagServerConfig = McpServerConfig & { enabled?: boolean };

/**
 * 通过 agent 框架已加载的 MCP 工具执行调用的回调。
 * toolName 是完整工具名（如 mcp__docs__query-docs），args 是参数对象。
 * 有此回调时优先使用，避免 retrieve node 重复 spawn MCP 进程。
 */
export type McpToolInvoker = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<string>;

/** MCP 服务器配置（从 config 传入） */
export interface RetrieveNodeConfig {
  mcpServers: Record<string, RagServerConfig>;
  retrievalTools: string[];
  retrieve: {
    maxResults: number;
    timeout_ms: number;
    retryCount: number;
  };
  /** 可选：复用 agent 框架已加载的 MCP 工具，避免重复 spawn 进程 */
  toolInvoker?: McpToolInvoker;
  /**
   * 可选：runtime 注入的持久 MultiServerMCPClient（经 getClient(server) 复用持久连接，多 transport）。
   * 优先级高于自管临时 client；低于 toolInvoker。
   */
  mcpClient?: MultiServerMCPClient;
  /** 可选：每个检索工具调用时回调一次（供 surface 展示「工具调用过程」） */
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
}

/** 从 resolve-library-id 类工具返回文本解析 library ID（取最高分或首个匹配）。 */
function extractLibraryIdFromResolveText(text: string): string | null {
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

function toolNameIncludes(tools: string[], ...needles: string[]): string | undefined {
  const lower = needles.map((n) => n.toLowerCase());
  return tools.find((t) => lower.some((n) => t.toLowerCase().includes(n)));
}

/** 文档库 MCP：resolve-library-id → query-docs（工具名按 server 探测）。 */
async function callDocLibraryViaInvoker(
  serverName: string,
  query: string,
  invoker: McpToolInvoker,
  keywords?: string[]
): Promise<RetrievalResult | null> {
  const resolveName = `mcp__${serverName}__resolve-library-id`;
  const queryName = `mcp__${serverName}__query-docs`;
  const libraryName = keywords?.[0] ?? query.split(/\s+/)[0] ?? query;

  try {
    const resolveText = await invoker(resolveName, { libraryName, query });
    const libraryId = extractLibraryIdFromResolveText(resolveText);
    if (libraryId) {
      const docsText = await invoker(queryName, { libraryId, query });
      return {
        tool: serverName,
        content: docsText,
        metadata: { server: serverName, libraryId, query },
      };
    }
    return {
      tool: serverName,
      content: resolveText,
      metadata: { server: serverName, query },
    };
  } catch {
    return null;
  }
}

async function callDocLibraryViaAccessor(
  serverName: string,
  query: string,
  accessor: McpAccessor,
  keywords?: string[]
): Promise<RetrievalResult | null> {
  const tools = await accessor.listTools();
  const resolveTool = toolNameIncludes(tools, "resolve-library-id", "resolve_library_id");
  const queryTool = toolNameIncludes(tools, "query-docs", "query_docs");
  if (!resolveTool || !queryTool) return null;

  const libraryName = keywords?.[0] ?? query.split(/\s+/)[0] ?? query;
  const resolveText = await accessor.callTool(resolveTool, { libraryName, query });
  const libraryId = extractLibraryIdFromResolveText(resolveText);

  if (libraryId) {
    const docsText = await accessor.callTool(queryTool, { libraryId, query });
    return {
      tool: serverName,
      content: docsText,
      metadata: { server: serverName, libraryId, query },
    };
  }
  return {
    tool: serverName,
    content: resolveText,
    metadata: { server: serverName, query },
  };
}

/**
 * 通过 agent 框架 toolInvoker 调用 MCP 工具（避免 spawn 进程）。
 */
async function callRetrievalToolViaInvoker(
  toolName: string,
  query: string,
  config: RetrieveNodeConfig,
  keywords?: string[]
): Promise<RetrievalResult> {
  const invoker = config.toolInvoker!;

  if (toolName === "howtocook-mcp") {
    const dishName = keywords?.[0] ?? query.split(/\s+/)[0];
    const raw = await invoker("mcp__howtocook__getRecipeById", { query: dishName });
    return {
      tool: toolName,
      content: extractHowtocookContent(raw),
      metadata: { server: toolName, query: dishName },
    };
  }

  const docResult = await callDocLibraryViaInvoker(toolName, query, invoker, keywords);
  if (docResult) return docResult;

  const raw = await invoker(toolName, { query });
  return { tool: toolName, content: raw, metadata: { server: toolName, query } };
}

/**
 * 根据意图选择工具
 */
function selectTools(
  availableTools: string[],
  intent?: string,
  mcpHint?: string
): string[] {
  if (mcpHint && availableTools.includes(mcpHint)) {
    return [mcpHint];
  }

  if (intent === "how_to" && availableTools.includes("howtocook-mcp")) {
    return ["howtocook-mcp"];
  }

  const nonCook = availableTools.filter((t) => t !== "howtocook-mcp");
  if (nonCook.length > 0) {
    return nonCook.slice(0, 3);
  }

  return availableTools.slice(0, 3);
}

/**
 * Retrieve 节点主函数
 */
export async function retrieveNode(
  state: RAGState,
  config: RetrieveNodeConfig,
  lgConfig?: LangGraphRunnableConfig
): Promise<Partial<RAGState>> {
  const { rewritten_query, intent, mcp_hint, keywords } = state;
  const query = rewritten_query || state.query;
  const attempts = (state.attempts ?? 0) + 1;

  if (!config.retrievalTools || config.retrievalTools.length === 0) {
    console.warn("[Retrieve] No retrieval tools configured");
    return { raw_results: [], attempts };
  }

  try {
    const toolsToUse = selectTools(config.retrievalTools, intent, mcp_hint);

    log.info("Using retrieval tools", { tools: toolsToUse, intent });

    const onToolCall =
      (lgConfig?.configurable?.onToolCall as RetrieveNodeConfig["onToolCall"]) ??
      config.onToolCall;
    const mcpClient =
      (lgConfig?.configurable?.mcpClient as MultiServerMCPClient | undefined) ??
      config.mcpClient;
    const effConfig: RetrieveNodeConfig = mcpClient ? { ...config, mcpClient } : config;

    const results = await Promise.allSettled(
      toolsToUse.map(async (toolName) => {
        const toolCallId = onToolCall ? randomUUID() : "";
        const args = { query, keywords: keywords ?? [] };
        if (onToolCall) {
          await onToolCall({ toolCallId, toolName, args, status: "in_progress" });
        }
        try {
          const res = await callRetrievalTool(toolName, query, effConfig, keywords);
          if (onToolCall) {
            await onToolCall({
              toolCallId,
              toolName,
              args,
              status: "completed",
              result: res.content,
            });
          }
          return res;
        } catch (err) {
          if (onToolCall) {
            await onToolCall({
              toolCallId,
              toolName,
              args,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        }
      })
    );

    const raw_results: RetrievalResult[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        raw_results.push(result.value);
      } else if (result.status === "rejected") {
        console.error(
          `[Retrieve] Tool ${toolsToUse[index]} failed:`,
          result.reason
        );
      }
    });

    return { raw_results, attempts };
  } catch (error) {
    console.error("[Retrieve] Error:", error);
    return { raw_results: [], attempts };
  }
}

function extractHowtocookContent(text: string): string {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const data = tryParse(text);
  if (!data) return text;

  if (Array.isArray(data)) {
    return data
      .map((r: { name?: string; description?: string }) =>
        r.description || r.name || JSON.stringify(r)
      )
      .join("\n\n---\n\n");
  }
  if (typeof data === "object" && data !== null) {
    const r = data as { description?: string; name?: string };
    return r.description || r.name || text;
  }
  return text;
}

async function callHowtocookViaAccessor(
  serverName: string,
  query: string,
  keywords: string[] | undefined,
  accessor: McpAccessor
): Promise<RetrievalResult> {
  const tools = await accessor.listTools();
  const recipeById = tools.find((n) => n.includes("getRecipeById"));
  const byCategory = tools.find((n) => n.includes("ByCategory"));
  const targetTool =
    recipeById ?? byCategory ?? tools[0] ?? "mcp_howtocook_getRecipeById";

  const dishName = keywords?.[0] ?? query.split(/\s+/)[0] ?? query;
  const toolArgs = recipeById ? { query: dishName } : { query };

  const result = await accessor.callTool(targetTool, toolArgs);
  return {
    tool: serverName,
    content: extractHowtocookContent(result),
    metadata: { server: serverName, tool: targetTool, query: dishName },
  };
}

/**
 * 调用检索工具。优先级：toolInvoker > 注入 mcpClient > 自管临时 client（mcp-access）。
 */
async function callRetrievalTool(
  toolName: string,
  query: string,
  config: RetrieveNodeConfig,
  keywords?: string[]
): Promise<RetrievalResult> {
  const serverConfig = config.mcpServers[toolName];

  if (!serverConfig) {
    throw new Error(`MCP server "${toolName}" not configured`);
  }

  if (!serverConfig.enabled && serverConfig.enabled !== undefined) {
    throw new Error(`MCP server "${toolName}" is disabled`);
  }

  log.info("Calling MCP tool", {
    tool: toolName,
    query,
    viaInvoker: !!config.toolInvoker,
    viaClient: !!config.mcpClient,
  });

  if (config.toolInvoker) {
    return callRetrievalToolViaInvoker(toolName, query, config, keywords);
  }

  const { accessor, dispose } = await resolveAccessor({
    client: config.mcpClient,
    server: toolName,
    config: serverConfig,
    timeoutMs: config.retrieve.timeout_ms,
  });
  try {
    if (toolName === "howtocook-mcp") {
      return callHowtocookViaAccessor(toolName, query, keywords, accessor);
    }

    const docResult = await callDocLibraryViaAccessor(toolName, query, accessor, keywords);
    if (docResult) return docResult;

    const tools = await accessor.listTools();
    const targetTool = tools[0] ?? "query";
    const result = await accessor.callTool(targetTool, { query });
    return {
      tool: toolName,
      content: result,
      metadata: { server: toolName, tool: targetTool, query },
    };
  } catch (error) {
    console.error(`[Retrieve] Error calling ${toolName}:`, error);
    throw error;
  } finally {
    await dispose?.();
  }
}
