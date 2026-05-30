/**
 * MCP Bridge Tool
 *
 * Allows the agent to call tools registered via MCP servers.
 * Built with @langchain/core/tools, bound to MCPManager at factory time.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { MCPManager } from "../../runtime/mcp-manager.js";

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

          // TODO: Implement actual MCP tool invocation via MCP SDK or platform runtime
          // For now, this validates inputs and returns a clear "not implemented" status
          // In a real implementation, this would:
          // 1. Connect to the MCP server
          // 2. Invoke the tool with the provided args
          // 3. Return the tool's response
          return JSON.stringify({
            status: "not_implemented",
            server,
            tool: toolName,
            args: args || {},
            message: `MCP tool invocation not yet implemented. Tool ${server}/${toolName} would be called with the provided arguments. Use platform_api(operation: "execute_plugin") for platform plugins instead.`,
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
