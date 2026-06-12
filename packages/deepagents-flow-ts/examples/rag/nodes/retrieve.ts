/**
 * Retrieve 节点 - MCP 工具调度
 *
 * 职责：
 * 1. 根据意图 + mcp_hint 决策调用哪些 MCP 工具
 * 2. 并行调用多个工具
 * 3. 收集原始结果
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { RAGState, RetrievalResult } from "./types.js";
import { logger } from "deepagents-app-ts/runtime";
import type { ToolCallEvent } from "../../../src/surfaces/flow-types.js";

// ACP stdio 模式下 stdout 是协议通道，日志必须走 logger（stderr）
const log = logger.child("rag-retrieve");

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

/**
 * 通过 agent 框架已加载的 MCP 工具执行调用的回调。
 * toolName 是完整工具名（如 mcp__context7__query-docs），args 是参数对象。
 * 有此回调时优先使用，避免 retrieve node 重复 spawn MCP 进程。
 */
export type McpToolInvoker = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<string>;

/** MCP 服务器配置（从 config 传入） */
export interface RetrieveNodeConfig {
  mcpServers: Record<string, MCPServerConfig>;
  retrievalTools: string[];
  retrieve: {
    maxResults: number;
    timeout_ms: number;
    retryCount: number;
  };
  /** 可选：复用 agent 框架已加载的 MCP 工具，避免重复 spawn 进程 */
  toolInvoker?: McpToolInvoker;
  /** 可选：每个检索工具调用时回调一次（供 surface 展示「工具调用过程」） */
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
}

/**
 * 调用 stdio MCP 服务器的方法
 */
async function callStdioMcpMethod(
  server: string,
  config: MCPServerConfig,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 10000
): Promise<unknown> {
  if (!config.command) {
    throw new Error(`MCP server "${server}" is not a stdio server`);
  }

  const child = spawn(config.command, config.args ?? [], {
    env: { ...process.env, ...config.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  type PendingEntry = {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
  };
  let nextId = 1;
  const pending = new Map<number, PendingEntry>();
  const stderr: string[] = [];

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line) as JsonRpcResponse;
      if (typeof message.id === "number") {
        const entry = pending.get(message.id);
        if (entry) {
          clearTimeout(entry.timer);
          if (message.error) {
            entry.reject(
              new Error(
                message.error.message ?? `MCP error ${message.error.code ?? ""}`
              )
            );
          } else {
            entry.resolve(message.result);
          }
          pending.delete(message.id);
        }
      }
    } catch {
      // Ignore non-JSON output
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 128) {
      stderr.push(chunk.toString("utf-8"));
    }
  });

  child.on("close", (code) => {
    if (pending.size > 0) {
      const err = new Error(
        `MCP server "${server}" exited unexpectedly (code ${code})${stderr.length ? ": " + stderr.join("").trim() : ""}`
      );
      for (const [, entry] of pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
    }
  });

  const send = (
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> => {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(
                new Error(
                  `MCP ${server}/${method} timed out after ${timeoutMs}ms`
                )
              );
            }, timeoutMs)
          : undefined;

      pending.set(id, {
        resolve,
        reject,
        timer: timer as ReturnType<typeof setTimeout>,
      });

      child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          if (timer) clearTimeout(timer);
          pending.delete(id);
          reject(err);
        }
      });
    });
  };

  try {
    // Initialize
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rag-agent", version: "1.0.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
    );

    return await send(method, params);
  } finally {
    rl.close();
    child.stdin.end();
    if (!child.killed) {
      child.kill();
    }
  }
}

/**
 * 列出 MCP 服务器的可用工具
 */
async function listMcpTools(
  server: string,
  config: MCPServerConfig
): Promise<any[]> {
  const result = (await callStdioMcpMethod(
    server,
    config,
    "tools/list",
    {},
    5000
  )) as any;
  return result?.tools || [];
}

/**
 * 调用 MCP 工具
 */
async function callMcpTool(
  server: string,
  config: MCPServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  return await callStdioMcpMethod(
    server,
    config,
    "tools/call",
    { name: toolName, arguments: args },
    timeoutMs
  );
}

/**
 * 通过 agent 框架 toolInvoker 调用 MCP 工具（避免 spawn 进程）。
 * 工具名称映射：toolName 是语义名（如 "context7"），invoker 使用完整工具名（如 "mcp__context7__query-docs"）。
 */
async function callRetrievalToolViaInvoker(
  toolName: string,
  query: string,
  config: RetrieveNodeConfig,
  keywords?: string[]
): Promise<RetrievalResult> {
  const invoker = config.toolInvoker!;

  if (toolName === "context7") {
    const libraryName = keywords?.[0] ?? query.split(/\s+/)[0];
    const resolveText = await invoker("mcp__context7__resolve-library-id", { libraryName, query });
    const libraryId = extractBestLibraryId(resolveText);
    if (libraryId) {
      const docsText = await invoker("mcp__context7__query-docs", { libraryId, query });
      return { tool: toolName, content: docsText, metadata: { server: toolName, libraryId, query } };
    }
    return { tool: toolName, content: resolveText, metadata: { server: toolName, query } };
  }

  if (toolName === "howtocook-mcp") {
    const dishName = keywords?.[0] ?? query.split(/\s+/)[0];
    const raw = await invoker("mcp__howtocook__getRecipeById", { query: dishName });
    return {
      tool: toolName,
      content: extractHowtocookContent(raw),
      metadata: { server: toolName, query: dishName },
    };
  }

  // 通用 fallback：尝试以工具语义名直接调用
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
  // 如果有明确的 hint，优先使用
  if (mcpHint && availableTools.includes(mcpHint)) {
    return [mcpHint];
  }

  // 根据意图选择工具（how_to 不预设 context7，技术类由 mcp_hint 驱动）
  const intentToolMap: Record<string, string[]> = {
    latest: ["context7"],
    factual: ["context7"],
    how_to: ["howtocook-mcp"],
    comparison: ["context7"],
    explain: ["context7"],
  };

  const preferredTools = intentToolMap[intent || "factual"] || [];
  const selected = preferredTools.filter((t) => availableTools.includes(t));

  return selected.length > 0 ? selected : availableTools.slice(0, 3);
}

/**
 * Retrieve 节点主函数
 */
export async function retrieveNode(
  state: RAGState,
  config: RetrieveNodeConfig
): Promise<Partial<RAGState>> {
  const { rewritten_query, intent, mcp_hint, keywords } = state;
  const query = rewritten_query || state.query;
  // 每执行一次检索就 +1，供 grade 的条件边判断是否还能重试（见 grade.ts）
  const attempts = (state.attempts ?? 0) + 1;

  if (!config.retrievalTools || config.retrievalTools.length === 0) {
    console.warn("[Retrieve] No retrieval tools configured");
    return { raw_results: [], attempts };
  }

  try {
    // 根据意图和 mcp_hint 选择工具
    const toolsToUse = selectTools(config.retrievalTools, intent, mcp_hint);

    log.info("Using retrieval tools", { tools: toolsToUse, intent });

    // 并行调用工具；每个工具发一次 tool_call 事件（供 surface 展示「工具调用过程」）
    const onToolCall = config.onToolCall;
    const results = await Promise.allSettled(
      toolsToUse.map(async (toolName) => {
        const toolCallId = onToolCall ? randomUUID() : "";
        const args = { query, keywords: keywords ?? [] };
        if (onToolCall) {
          await onToolCall({ toolCallId, toolName, args, status: "in_progress" });
        }
        try {
          const res = await callRetrievalTool(toolName, query, config, keywords);
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

    // 收集成功的结果
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

/**
 * 从 MCP tools/call 响应里提取纯文本内容。
 * 响应结构: { content: [{ type: "text", text: "..." }, ...] }
 */
function extractMcpText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return JSON.stringify(result);
  return r.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/**
 * 从 resolve-library-id 返回的文本中解析 Context7-compatible library ID。
 * 取 Benchmark Score 最高的那一条；如果无法解析则返回 null。
 *
 * 返回格式示例: "/langchain-ai/langgraph"
 */
function extractBestLibraryId(text: string): string | null {
  const blockPattern = /Context7-compatible library ID:\s*(\S+)[\s\S]*?Benchmark Score:\s*([\d.]+)/g;
  let best: { id: string; score: number } | null = null;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const id = match[1];
    const score = parseFloat(match[2]);
    if (!best || score > best.score) {
      best = { id, score };
    }
  }

  if (best) return best.id;

  // Fallback: 取第一个出现的 ID
  const fallback = text.match(/Context7-compatible library ID:\s*(\S+)/);
  return fallback ? fallback[1] : null;
}

/**
 * 解析 howtocook-mcp 返回的 JSON 内容，提取可读的菜谱文本。
 * 工具返回格式: '{"name":"...","description":"# 菜名\n..."}' 或 JSON 数组
 */
function extractHowtocookContent(text: string): string {
  const tryParse = (s: string) => {
    try { return JSON.parse(s); } catch { return null; }
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

/**
 * 调用检索工具
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

  log.info("Calling MCP tool", { tool: toolName, query, viaInvoker: !!config.toolInvoker });

  // 有 toolInvoker 时直接复用 agent 框架已加载的工具，避免重复 spawn 进程
  if (config.toolInvoker) {
    return callRetrievalToolViaInvoker(toolName, query, config, keywords);
  }

  try {
    // 先列出可用工具
    const tools = await listMcpTools(toolName, serverConfig);
    log.info("Listed MCP tools", { tool: toolName, toolCount: tools.length });

    // 根据服务器选择合适的工具和参数
    let targetTool: string;
    let toolArgs: Record<string, unknown>;

    if (toolName === "context7") {
      // Step 1: 解析库 ID
      // libraryName 用 keywords[0]（rewrite 提取的技术名词），query 用于相关性排序
      const libraryName = keywords?.[0] ?? query.split(/\s+/)[0];
      const resolveResult = await callMcpTool(
        toolName,
        serverConfig,
        "resolve-library-id",
        { libraryName, query },
        config.retrieve.timeout_ms
      );

      const resolveText = extractMcpText(resolveResult);
      const libraryId = extractBestLibraryId(resolveText);

      if (libraryId) {
        // Step 2: 查询文档
        const queryResult = await callMcpTool(
          toolName,
          serverConfig,
          "query-docs",
          { libraryId, query },
          config.retrieve.timeout_ms
        );

        return {
          tool: toolName,
          content: extractMcpText(queryResult),
          metadata: { server: toolName, libraryId, query },
        };
      }

      // resolve 没拿到 ID，把 resolve 文本作为上下文返回
      return {
        tool: toolName,
        content: resolveText,
        metadata: { server: toolName, query },
      };
    } else if (toolName === "howtocook-mcp") {
      // 优先使用 getRecipeById（模糊匹配菜名），其次按分类，fallback 到第一个工具
      const recipeById = tools.find((t) => t.name.includes("getRecipeById"));
      const byCategory = tools.find((t) => t.name.includes("ByCategory"));
      targetTool = recipeById?.name ?? byCategory?.name ?? tools[0]?.name ?? "mcp_howtocook_getRecipeById";

      // getRecipeById 用菜名关键词（keywords[0]）效果最好；其他工具回退到完整 query
      const dishName = keywords?.[0] ?? query.split(/\s+/)[0];
      toolArgs = recipeById ? { query: dishName } : { query };

      const result = await callMcpTool(
        toolName,
        serverConfig,
        targetTool,
        toolArgs,
        config.retrieve.timeout_ms
      );

      return {
        tool: toolName,
        content: extractHowtocookContent(extractMcpText(result)),
        metadata: { server: toolName, tool: targetTool, query: dishName },
      };
    } else {
      // 通用：使用第一个可用工具
      targetTool = tools[0]?.name || "query";
      toolArgs = { query };

      const result = await callMcpTool(
        toolName,
        serverConfig,
        targetTool,
        toolArgs,
        config.retrieve.timeout_ms
      );

      return {
        tool: toolName,
        content: extractMcpText(result),
        metadata: { server: toolName, tool: targetTool, query },
      };
    }
  } catch (error) {
    console.error(`[Retrieve] Error calling ${toolName}:`, error);
    throw error;
  }
}
