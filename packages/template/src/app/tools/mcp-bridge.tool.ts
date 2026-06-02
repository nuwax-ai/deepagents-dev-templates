/**
 * MCP Bridge Tool
 *
 * Allows the agent to call tools registered via MCP servers.
 * Built with @langchain/core/tools, bound to MCPManager at factory time.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { MCPManager, MCPServerConfig } from "../../runtime/mcp-manager.js";

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

function resolveServerEnv(config: MCPServerConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(config.env ?? {})) {
    const match = value.match(/^\$\{([A-Z0-9_]+)\}$/);
    env[key] = match ? process.env[match[1]!] ?? "" : value;
  }
  return env;
}

async function callStdioMcpTool(
  server: string,
  config: MCPServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!config.command) {
    throw new Error(`MCP server "${server}" is not a stdio server; only command-based MCP servers are supported in this template runtime`);
  }

  const timeoutMs = Number(process.env.MCP_TOOL_TIMEOUT_MS ?? 30_000);
  const child = spawn(config.command, config.args ?? [], {
    env: resolveServerEnv(config),
    stdio: ["pipe", "pipe", "pipe"],
  });

  type PendingEntry = { resolve: (result: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };
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
            entry.reject(new Error(message.error.message ?? `MCP error ${message.error.code ?? ""}`));
          } else {
            entry.resolve(message.result);
          }
          pending.delete(message.id);
        }
      }
    } catch {
      // Ignore non-JSON diagnostic output from MCP child processes.
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk.toString("utf-8"));
  });

  // If the child exits unexpectedly, reject all pending promises immediately
  // instead of waiting for individual timeouts.
  child.on("close", (code) => {
    if (pending.size > 0) {
      const err = new Error(`MCP server "${server}" exited unexpectedly (code ${code})${stderr.length ? ": " + stderr.join("").trim() : ""}`);
      for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(err); }
      pending.clear();
    }
  });

  const send = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${server}/${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      pending.set(id, { resolve, reject, timer });

      child.stdin.write(`${payload}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
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
      clientInfo: {
        name: "deepagents-dev-templates",
        version: "0.1.0",
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    return await send("tools/call", {
      name: toolName,
      arguments: args,
    });
  } finally {
    rl.close();
    child.stdin.end();
    if (!child.killed) {
      child.kill();
    }
    if (stderr.length > 0 && process.env.LOG_LEVEL === "debug") {
      console.error(stderr.join(""));
    }
  }
}

/**
 * Create the mcp_tool_bridge tool bound to a specific MCPManager instance.
 */
export function createMcpBridgeTool(mcpManager: MCPManager) {
  return tool(
    async ({ operation, server, toolName, args }) => {
      switch (operation) {
        case "list_servers": {
          const servers = mcpManager.listServers();
          const config = mcpManager.getMergedConfig();
          return JSON.stringify({
            count: servers.length,
            servers: servers.map((name) => ({
              name,
              config: config.servers[name],
            })),
          });
        }

        case "call_tool": {
          if (!server || !toolName) {
            return "Error: 'server' and 'toolName' are required for call_tool";
          }

          const serverConfig = mcpManager.getServer(server);
          if (!serverConfig) {
            return `Error: MCP server "${server}" not found. Use list_servers to see available servers.`;
          }

          const result = await callStdioMcpTool(
            server,
            serverConfig,
            toolName,
            args || {}
          );

          return JSON.stringify({
            status: "ok",
            server,
            tool: toolName,
            result,
          });
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    },
    {
      name: "mcp_tool_bridge",
      description: `Call tools registered via MCP (Model Context Protocol) servers.
Platform-configured plugins are exposed as MCP tools.

IMPORTANT: Before writing custom code for a tool, ALWAYS check if
a platform plugin already provides the functionality you need.

Operations:
- list_servers: List all configured MCP servers
- call_tool: Call a specific tool on an MCP server (params: server, toolName, args?)`,
      schema: z.object({
        operation: z
          .enum(["list_servers", "call_tool"])
          .describe("MCP bridge operation"),
        server: z
          .string()
          .optional()
          .describe("MCP server name (e.g., 'context7', 'nuwax-email-plugin')"),
        toolName: z
          .string()
          .optional()
          .describe("Tool name within the MCP server"),
        args: z
          .record(z.unknown())
          .optional()
          .describe("Arguments to pass to the MCP tool"),
      }),
    }
  );
}
