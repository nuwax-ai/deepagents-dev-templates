/**
 * 通用 stdio MCP 客户端（提炼自 examples/rag/nodes/retrieve.ts）。
 *
 * spawn 一个 MCP server 子进程，走 JSON-RPC over stdio：initialize 握手 → tools/call → 收结果 → 关进程。
 * 供示例节点接真实 MCP 工具（如 context7 文档检索）。
 *
 * 还提供 rateLimited：把并发调用串行化 + 保证最小间隔——接有 rate limit 的免费 API
 * 必备，即使图是并行的，外部请求也会错峰。
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

/**
 * 开一个 stdio MCP 会话：spawn → initialize 握手 → 把 `call(method, params)` 交给 fn 多次调用 → 关进程。
 * 复用单个子进程完成 list+call 等多步逻辑检索（避免每步各冷启动一个进程）。
 */
async function withStdioMcpSession<T>(
  config: McpServerConfig,
  fn: (call: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
  timeoutMs = 15000
): Promise<T> {
  const child = spawn(config.command, config.args ?? [], {
    env: { ...process.env, ...config.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> }
  >();
  const stderr: string[] = [];

  const rejectAll = (err: Error) => {
    for (const [, e] of pending) {
      if (e.timer) clearTimeout(e.timer);
      e.reject(err);
    }
    pending.clear();
  };

  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      if (typeof msg.id === "number") {
        const entry = pending.get(msg.id);
        if (entry) {
          if (entry.timer) clearTimeout(entry.timer);
          if (msg.error) entry.reject(new Error(msg.error.message ?? `MCP error ${msg.error.code ?? ""}`));
          else entry.resolve(msg.result);
          pending.delete(msg.id);
        }
      }
    } catch {
      /* 非 JSON 行（部分 server 往 stdout 打日志）忽略 */
    }
  });
  child.stderr.on("data", (c: Buffer) => {
    if (stderr.length < 64) stderr.push(c.toString());
  });
  child.on("error", (err) => rejectAll(err)); // spawn 失败（如命令不存在）
  child.on("close", (code) => {
    if (pending.size) {
      rejectAll(
        new Error(
          `MCP server exited (code ${code})${stderr.length ? ": " + stderr.join("").trim().slice(0, 200) : ""}`
        )
      );
    }
  });

  const send = (m: string, p?: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error(`MCP ${m} timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : undefined;
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: m, params: p })}\n`, (err) => {
        if (err) {
          if (timer) clearTimeout(timer);
          pending.delete(id);
          reject(err);
        }
      });
    });
  };

  try {
    await send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "flow-example", version: "1.0.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return await fn((method, params) => send(method, params));
  } finally {
    rl.close();
    child.stdin.end();
    if (!child.killed) child.kill();
  }
}

/** spawn MCP server、initialize、调一个方法、收结果、关进程（单方法便捷封装，复用 withStdioMcpSession）。 */
async function callStdioMcp(
  config: McpServerConfig,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 15000
): Promise<unknown> {
  return withStdioMcpSession(config, (call) => call(method, params), timeoutMs);
}

/** 从 MCP tools/call 响应提取纯文本（{ content: [{type:"text",text}] }）。 */
export function extractMcpText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (!Array.isArray(r.content)) return JSON.stringify(result);
  return r.content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** 调一个 MCP 工具，返回纯文本结果。 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 15000
): Promise<string> {
  const result = await callStdioMcp(config, "tools/call", { name: toolName, arguments: args }, timeoutMs);
  return extractMcpText(result);
}

/** 列出 MCP server 暴露的工具名（tools/list）。 */
export async function listMcpTools(
  config: McpServerConfig,
  timeoutMs = 15000
): Promise<string[]> {
  const result = await callStdioMcp(config, "tools/list", {}, timeoutMs);
  const tools = (result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];
  return tools.map((t) => t.name).filter((n): n is string => Boolean(n));
}

/** 列出工具的原始 tools/list 响应（含参数 schema）；需要完整响应时用（listMcpTools 只返回名字数组）。 */
export async function listMcpToolsRaw(config: McpServerConfig, timeoutMs = 15000): Promise<unknown> {
  return callStdioMcp(config, "tools/list", {}, timeoutMs);
}

/**
 * 解析真实工具名 —— 不同 MCP 包版本工具名可能不同。
 * 优先精确匹配 preferred，再试 aliases，再模糊匹配，最后若仅一个工具则用之。
 */
export async function resolveMcpToolName(
  config: McpServerConfig,
  preferred: string,
  aliases: string[] = [],
  timeoutMs = 15000
): Promise<string> {
  const available = await listMcpTools(config, timeoutMs);
  return chooseMcpToolName(available, preferred, aliases);
}

/** 纯函数：从 tools/list 的名称里选择最合适的工具名。 */
export function chooseMcpToolName(
  available: string[],
  preferred: string,
  aliases: string[] = []
): string {
  if (available.includes(preferred)) return preferred;
  for (const alias of aliases) {
    if (available.includes(alias)) return alias;
  }
  const prefLower = preferred.toLowerCase();
  const fuzzy = available.find(
    (n) =>
      n.toLowerCase().includes(prefLower) ||
      prefLower.includes(n.toLowerCase())
  );
  if (fuzzy) return fuzzy;
  if (available.length === 1) return available[0]!;
  throw new Error(
    `MCP 工具未找到: ${preferred}；可用工具: ${available.join(", ") || "(none)"}`
  );
}

/**
 * 先 resolve 工具名再调用（示例节点推荐入口）。
 * 单个子进程内完成 tools/list → 选名 → tools/call（避免 resolve 与 call 各冷启动一次）。
 */
export async function callResolvedMcpTool(
  config: McpServerConfig,
  preferred: string,
  args: Record<string, unknown>,
  options: { aliases?: string[]; timeoutMs?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const aliases = options.aliases ?? ["search", "web_search", "query"];
  return withStdioMcpSession(
    config,
    async (call) => {
      const listResult = await call("tools/list", {});
      const available = ((listResult as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [])
        .map((t) => t.name)
        .filter((n): n is string => Boolean(n));
      const toolName = chooseMcpToolName(available, preferred, aliases);
      const result = await call("tools/call", { name: toolName, arguments: args });
      return extractMcpText(result);
    },
    timeoutMs
  );
}

/**
 * 全局节流：把并发调用串行化，且每次之间至少间隔 minGapMs。
 * 接有 rate limit 的免费 API（如 DDG 1/秒）必备——图并行，但外部请求错峰执行。
 */
let gate: Promise<unknown> = Promise.resolve();
export function rateLimited<T>(fn: () => Promise<T>, minGapMs = 1200): Promise<T> {
  const run = gate.then(async () => {
    try {
      return await fn();
    } finally {
      await new Promise((r) => setTimeout(r, minGapMs));
    }
  });
  // gate 推进到本次完成（吞掉错误，避免链断）
  gate = run.then(
    () => undefined,
    () => undefined
  );
  return run as Promise<T>;
}
