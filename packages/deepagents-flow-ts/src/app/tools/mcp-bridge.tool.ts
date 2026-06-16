/**
 * MCP bridge 工具 —— 列出 / 调用已配置的 MCP server（context7/chrome-devtools/业务插件）。
 *
 * 元工具（list_servers / list_tools / call_tool）—— 用于运行时发现并调用任意已配置 MCP 工具，
 * 与把 MCP 工具直接加载为 native StructuredTool（runtime-context 经 mcp-adapters）互补：
 * 当某 MCP server 工具名单动态、或想手动发现时用本工具。
 *
 * 接收 runtime-context 合并后的 server 配置 map（default + session + platform），
 * 实际 MCP 调用走 flow-ts 自有的 mcp-stdio（直连），不经 MCPManager。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { callMcpTool, listMcpTools, type McpServerConfig } from "../../runtime/mcp-stdio.js";
import type { McpServerEntry } from "../../vendor/runtime/runtime-context.js";

function toServerConfig(cfg: McpServerEntry): McpServerConfig | null {
  if (!cfg.command) return null;
  return { command: cfg.command, args: cfg.args, env: cfg.env };
}

export function createMcpBridgeTool(serverConfigs: Record<string, McpServerEntry>) {
  return tool(
    async ({ operation, server, toolName, args }) => {
      switch (operation) {
        case "list_servers":
          return JSON.stringify(Object.keys(serverConfigs));

        case "list_tools": {
          if (!server) return "Error: 'server' is required for list_tools";
          const cfg = serverConfigs[server];
          if (!cfg) return `Error: MCP server "${server}" not found`;
          const sc = toServerConfig(cfg);
          if (!sc) return `Error: "${server}" is not a stdio server`;
          const result = await listMcpTools(sc);
          return JSON.stringify({ server, result });
        }

        case "call_tool": {
          if (!server || !toolName) return "Error: 'server' and 'toolName' are required for call_tool";
          const cfg = serverConfigs[server];
          if (!cfg) return `Error: MCP server "${server}" not found`;
          const sc = toServerConfig(cfg);
          if (!sc) return `Error: "${server}" is not a stdio server`;
          const result = await callMcpTool(sc, toolName, args ?? {});
          return result;
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    },
    {
      name: "mcp_tool_bridge",
      description: `列出 / 调用经 MCP 配置的工具（context7 文档、chrome-devtools 浏览、平台插件等）。
先 list_servers 看有哪些 → list_tools 看某 server 的工具与参数 schema → call_tool 调用。
Operations:
- list_servers：列出所有已配置 MCP server
- list_tools：列某 server 的工具（params: server）
- call_tool：调一个 MCP 工具（params: server, toolName, args?）`,
      schema: z.object({
        operation: z.enum(["list_servers", "list_tools", "call_tool"]),
        server: z
          .string()
          .optional()
          .describe("MCP server 名（如 'context7'）"),
        toolName: z.string().optional().describe("server 内的工具名"),
        args: z.record(z.unknown()).optional().describe("传给工具的参数"),
      }),
    }
  );
}
