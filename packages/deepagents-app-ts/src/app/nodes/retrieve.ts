/**
 * Retrieve 节点 - MCP 工具调度
 *
 * 职责：
 * 1. 根据意图 + mcp_hint 决策调用哪些 MCP 工具
 * 2. 并行调用多个工具
 * 3. 收集原始结果
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { RAGState, RetrievalResult, RAGConfig } from "./types.js";

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

/** MCP 服务器配置（从 config 传入） */
export interface RetrieveNodeConfig {
  mcpServers: Record<string, MCPServerConfig>;
  retrievalTools: string[];
  retrieve: {
    maxResults: number;
    timeout_ms: number;
    retryCount: number;
  };
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

  // 根据意图选择工具
  const intentToolMap: Record<string, string[]> = {
    latest: ["context7"],           // 最新信息用 context7
    factual: ["context7"],          // 事实查询用 context7
    how_to: ["howtocook-mcp", "context7"],  // 操作指南用 howtocook + context7
    comparison: ["context7"],       // 对比用 context7
    explain: ["context7"],          // 解释用 context7
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
  const { rewritten_query, intent, mcp_hint } = state;
  const query = rewritten_query || state.query;

  if (!config.retrievalTools || config.retrievalTools.length === 0) {
    console.warn("[Retrieve] No retrieval tools configured");
    return { raw_results: [] };
  }

  try {
    // 根据意图和 mcp_hint 选择工具
    const toolsToUse = selectTools(config.retrievalTools, intent, mcp_hint);

    console.log(
      `[Retrieve] Using tools: ${toolsToUse.join(", ")} for intent: ${intent}`
    );

    // 并行调用工具
    const results = await Promise.allSettled(
      toolsToUse.map((toolName) =>
        callRetrievalTool(toolName, query, config)
      )
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

    return { raw_results };
  } catch (error) {
    console.error("[Retrieve] Error:", error);
    return { raw_results: [] };
  }
}

/**
 * 调用检索工具
 */
async function callRetrievalTool(
  toolName: string,
  query: string,
  config: RetrieveNodeConfig
): Promise<RetrievalResult> {
  const serverConfig = config.mcpServers[toolName];

  if (!serverConfig) {
    throw new Error(`MCP server "${toolName}" not configured`);
  }

  if (!serverConfig.enabled && serverConfig.enabled !== undefined) {
    throw new Error(`MCP server "${toolName}" is disabled`);
  }

  console.log(`[Retrieve] Calling MCP tool: ${toolName} with query: ${query}`);

  try {
    // 先列出可用工具
    const tools = await listMcpTools(toolName, serverConfig);
    console.log(`[Retrieve] ${toolName} has ${tools.length} tools`);

    // 根据服务器选择合适的工具和参数
    let targetTool: string;
    let toolArgs: Record<string, unknown>;

    if (toolName === "context7") {
      // Context7 的工具: resolve-library-id, query-docs
      // 先解析库 ID，再查询文档
      targetTool = "resolve-library-id";
      toolArgs = { query };

      const resolveResult = await callMcpTool(
        toolName,
        serverConfig,
        targetTool,
        toolArgs,
        config.retrieve.timeout_ms
      );

      // 如果有库 ID，查询文档
      if (
        resolveResult &&
        typeof resolveResult === "object" &&
        "libraryId" in resolveResult
      ) {
        const libraryId = (resolveResult as any).libraryId;
        const queryResult = await callMcpTool(
          toolName,
          serverConfig,
          "query-docs",
          { libraryId, query },
          config.retrieve.timeout_ms
        );

        return {
          tool: toolName,
          content: JSON.stringify(queryResult),
          metadata: {
            server: toolName,
            libraryId,
            query,
          },
        };
      }

      return {
        tool: toolName,
        content: JSON.stringify(resolveResult),
        metadata: { server: toolName, query },
      };
    } else if (toolName === "howtocook-mcp") {
      // howtocook-mcp 的工具
      // 使用第一个可用工具
      targetTool = tools[0]?.name || "search";
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
        content: JSON.stringify(result),
        metadata: { server: toolName, tool: targetTool, query },
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
        content: JSON.stringify(result),
        metadata: { server: toolName, tool: targetTool, query },
      };
    }
  } catch (error) {
    console.error(`[Retrieve] Error calling ${toolName}:`, error);
    throw error;
  }
}
