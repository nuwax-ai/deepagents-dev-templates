/**
 * 通用 stdio MCP 客户端（提炼自 examples/rag/nodes/retrieve.ts）。
 *
 * spawn 一个 MCP server 子进程，走 JSON-RPC over stdio：initialize 握手 → tools/call → 收结果 → 关进程。
 * 供示例节点接真实 MCP 工具（如 DuckDuckGo 网络搜索）。
 *
 * 还提供 rateLimited：把并发调用串行化 + 保证最小间隔——接有 rate limit 的免费 API
 * （如 DuckDuckGo 限 1 请求/秒）必备，即使图是并行的，外部请求也会错峰。
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

/** spawn MCP server、initialize、调一个方法、收结果、关进程。 */
async function callStdioMcp(
  config: McpServerConfig,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 15000
): Promise<unknown> {
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
    return await send(method, params);
  } finally {
    rl.close();
    child.stdin.end();
    if (!child.killed) child.kill();
  }
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
